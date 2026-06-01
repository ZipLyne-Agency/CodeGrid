use crate::db::Database;
use crate::pty_manager::PtyManager;
use crate::session::{Session, SessionStatus};
use crate::workspace::Workspace;
use crate::worktree::WorktreeManager;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex as TokioMutex;
use uuid::Uuid;

pub struct AppState {
    pub pty_manager: PtyManager,
    pub db: Database,
    pub sessions: TokioMutex<Vec<Session>>,
    pub connect_signals: TokioMutex<std::collections::HashMap<String, tokio::sync::oneshot::Sender<()>>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SessionInfo {
    pub id: String,
    pub workspace_id: String,
    pub working_dir: String,
    pub command: String,
    pub git_branch: Option<String>,
    pub status: String,
    pub created_at: String,
    pub pane_number: u32,
    pub worktree_path: Option<String>,
    /// User-assigned name, persisted to DB. None = auto-detected from terminal activity.
    pub name: Option<String>,
}

impl From<&Session> for SessionInfo {
    fn from(s: &Session) -> Self {
        Self {
            id: s.id.clone(),
            workspace_id: s.workspace_id.clone(),
            working_dir: s.working_dir.clone(),
            command: s.command.clone(),
            git_branch: s.git_branch.clone(),
            status: match &s.status {
                SessionStatus::Idle => "idle".to_string(),
                SessionStatus::Running => "running".to_string(),
                SessionStatus::Waiting => "waiting".to_string(),
                SessionStatus::Error => "error".to_string(),
                SessionStatus::Dead => "dead".to_string(),
            },
            created_at: s.created_at.clone(),
            pane_number: s.pane_number,
            worktree_path: s.worktree_path.clone(),
            name: s.name.clone(),
        }
    }
}

#[derive(Debug, Serialize, Clone)]
pub struct PtyOutput {
    pub session_id: String,
    pub data: Vec<u8>,
}

/// Scratch / throwaway terminals are spawned under a sentinel workspace id (see
/// `SCRATCH_WORKSPACE_ID` in src/components/ScratchPane.tsx). Sessions in such a
/// workspace are *ephemeral*: hidden from the agent-bus and never persisted to the
/// DB, so they stay private to their pane and never restore on relaunch.
pub fn is_ephemeral_workspace(workspace_id: &str) -> bool {
    workspace_id.starts_with("__scratch__")
}

fn expand_tilde(path: &str) -> String {
    if path.starts_with('~') {
        if let Ok(home) = std::env::var("HOME") {
            return path.replacen('~', &home, 1);
        }
    }
    path.to_string()
}

fn allowed_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(home) = std::env::var("HOME") {
        let home_path = PathBuf::from(home);
        if let Ok(canonical) = home_path.canonicalize() {
            roots.push(canonical);
        } else {
            roots.push(home_path);
        }
    }
    roots.push(PathBuf::from("/tmp"));
    roots
}

fn is_path_within_allowed_roots(path: &Path) -> bool {
    let canonical_path = match path.canonicalize() {
        Ok(p) => p,
        Err(_) => return false,
    };
    allowed_roots()
        .iter()
        .any(|root| canonical_path.starts_with(root))
}

fn is_path_or_parent_within_allowed_roots(path: &Path) -> bool {
    if path.exists() {
        return is_path_within_allowed_roots(path);
    }
    match path.parent() {
        Some(parent) => is_path_within_allowed_roots(parent),
        None => false,
    }
}

// === Session Commands ===

#[tauri::command]
pub async fn create_session(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    working_dir: String,
    workspace_id: String,
    use_worktree: bool,
    resume: bool,
    session_type: Option<String>,
    #[allow(non_snake_case)] continue_session: Option<bool>,
) -> Result<SessionInfo, String> {
    // `continue_session` (used on app-restart restore) auto-continues the most
    // recent conversation in the working dir, non-interactively — distinct from
    // `resume`, which opens an interactive picker.
    let continue_session = continue_session.unwrap_or(false);
    let working_dir = validate_dir(&working_dir)?;
    let session_id = Uuid::new_v4().to_string();
    let pane_number = 1;

    // Determine actual working directory (possibly a worktree)
    let (actual_dir, worktree_path, git_branch) = if use_worktree
        && WorktreeManager::is_git_repo(&working_dir)
    {
        // Check if another session is already working in this repo
        let sessions = state.sessions.lock().await;
        let repo_root = WorktreeManager::git_root(&working_dir);
        let needs_worktree = repo_root.as_ref().is_some_and(|root| {
            sessions.iter().any(|s| {
                let s_root = WorktreeManager::git_root(&s.working_dir);
                s_root.as_ref() == Some(root)
            })
        });
        drop(sessions);

        if needs_worktree {
            let (wt_path, branch) =
                WorktreeManager::create_worktree(&working_dir, &session_id)?;
            (wt_path.clone(), Some(wt_path), Some(branch))
        } else {
            let branch = WorktreeManager::current_branch(&working_dir);
            (working_dir.clone(), None, branch)
        }
    } else {
        let branch = if WorktreeManager::is_git_repo(&working_dir) {
            WorktreeManager::current_branch(&working_dir)
        } else {
            None
        };
        (working_dir.clone(), None, branch)
    };

    // Resolve binary and args based on session type
    let agent_type = session_type.as_deref().unwrap_or("claude");
    let (command_path, args) = match agent_type {
        "codex" => {
            let path = which::which("codex")
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| "codex".to_string());
            (path, Vec::new())
        }
        "gemini" => {
            let path = which::which("gemini")
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| "gemini".to_string());
            (path, Vec::new())
        }
        "cursor" => {
            // The Cursor CLI binary is named `cursor-agent`; some installs also
            // create a `cursor` shim. `agent` is only a last-resort fallback.
            let path = which::which("cursor-agent")
                .or_else(|_| which::which("cursor"))
                .or_else(|_| which::which("agent"))
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| "cursor-agent".to_string());
            (path, Vec::new())
        }
        "grok" => {
            // xAI Grok Build CLI. Installer drops the binary in ~/.grok/bin,
            // which may not be on PATH yet, so fall back to that location.
            let path = which::which("grok")
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| {
                    std::env::var("HOME")
                        .ok()
                        .map(|h| PathBuf::from(h).join(".grok").join("bin").join("grok"))
                        .filter(|p| p.exists())
                        .map(|p| p.to_string_lossy().to_string())
                        .unwrap_or_else(|| "grok".to_string())
                });
            (path, Vec::new())
        }
        _ => {
            // Default: Claude Code
            let path = which::which("claude")
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| "claude".to_string());
            let mut a = Vec::new();
            if continue_session {
                // Resume the most recent conversation in this dir, no prompt.
                a.push("--continue".to_string());
            } else if resume {
                a.push("--resume".to_string());
            }
            (path, a)
        }
    };
    eprintln!("[CodeGrid] Agent: {agent_type} binary: {command_path}");
    eprintln!("[CodeGrid] Working dir: {actual_dir}");

    // Spawn PTY
    let mut rx = state.pty_manager.spawn_session(
        &session_id,
        &actual_dir,
        &command_path,
        &args,
        120,
        30,
    )?;

    // Create session object
    let mut session = Session::new(
        session_id.clone(),
        workspace_id,
        actual_dir,
        command_path,
        pane_number,
    );
    session.git_branch = git_branch;
    session.worktree_path = worktree_path;
    session.status = SessionStatus::Running;

    // Assign pane number under lock to avoid races with concurrent session creation.
    {
        let mut sessions = state.sessions.lock().await;
        session.pane_number = sessions
            .iter()
            .filter(|s| s.workspace_id == session.workspace_id)
            .map(|s| s.pane_number)
            .max()
            .unwrap_or(0) + 1;
        sessions.push(session.clone());
    }
    // Ephemeral (scratch) sessions are never written to the DB.
    if !is_ephemeral_workspace(&session.workspace_id) {
        let _ = state.db.save_session(&session);
    }
    let info = SessionInfo::from(&session);

    // Buffer PTY output until frontend connects its event listeners
    let (connect_tx, connect_rx) = tokio::sync::oneshot::channel::<()>();
    state.connect_signals.lock().await.insert(session_id.clone(), connect_tx);

    let app_handle = app.clone();
    let state_for_task = state.inner().clone();
    let sid = session_id.clone();
    eprintln!("[CodeGrid] Session {session_id} created, waiting for frontend connect");

    tokio::spawn(async move {
        // Wait for frontend to signal it's ready (or timeout after 5s as fallback)
        tokio::select! {
            _ = connect_rx => { eprintln!("[CodeGrid] Session {sid} connected by frontend"); },
            _ = tokio::time::sleep(std::time::Duration::from_secs(5)) => { eprintln!("[CodeGrid] Session {sid} connect timed out, starting anyway"); },
        }

        let mut count = 0u64;
        // Now stream all output (mpsc unbounded channel has been buffering)
        while let Some(data) = rx.recv().await {
            count += data.len() as u64;
            if count <= 1000 || count % 10000 < 100 {
                eprintln!("[CodeGrid] Session {} emitting {} bytes (total: {})", sid, data.len(), count);
            }
            let _ = app_handle.emit(
                "pty-output",
                PtyOutput {
                    session_id: sid.clone(),
                    data,
                },
            );
        }
        eprintln!("[CodeGrid] Session {sid} ended (total bytes: {count})");
        state_for_task.connect_signals.lock().await.remove(&sid);
        let _ = state_for_task.pty_manager.remove_session(&sid);
        {
            let mut sessions = state_for_task.sessions.lock().await;
            if let Some(s) = sessions.iter_mut().find(|s| s.id == sid) {
                s.status = SessionStatus::Dead;
            }
        }
        let _ = app_handle.emit(
            "session-ended",
            serde_json::json!({ "session_id": sid }),
        );
    });

    Ok(info)
}

#[tauri::command]
pub async fn write_to_pty(
    state: State<'_, Arc<AppState>>,
    session_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    state.pty_manager.write_to_pty(&session_id, &data)
}

#[tauri::command]
pub async fn resize_pty(
    state: State<'_, Arc<AppState>>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.pty_manager.resize_pty(&session_id, cols, rows)
}

#[tauri::command]
pub async fn kill_session(
    state: State<'_, Arc<AppState>>,
    session_id: String,
) -> Result<(), String> {
    // Clean up the connect signal so the buffering task unblocks immediately
    // instead of waiting for the 5-second timeout
    let signal = state.connect_signals.lock().await.remove(&session_id);
    if let Some(tx) = signal {
        let _ = tx.send(());
    }

    // Don't abort on a missing PTY: a naturally-exited ("dead") terminal has
    // already had its PTY drained, but we still must delete its DB row and remove
    // any worktree below — otherwise the dead session resurrects on next launch.
    let _ = state.pty_manager.kill_session(&session_id);

    let mut sessions = state.sessions.lock().await;
    if let Some(pos) = sessions.iter().position(|s| s.id == session_id) {
        let session = sessions.remove(pos);
        drop(sessions);
        let _ = state.db.delete_session(&session_id);

        // Clean up worktree if applicable
        if let Some(wt_path) = &session.worktree_path {
            if let Some(root) = WorktreeManager::git_root(&session.working_dir) {
                let _ = WorktreeManager::remove_worktree(&root, wt_path);
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn get_sessions(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
) -> Result<Vec<SessionInfo>, String> {
    let sessions = state.sessions.lock().await;
    Ok(sessions
        .iter()
        .filter(|s| s.workspace_id == workspace_id)
        .map(SessionInfo::from)
        .collect())
}

/// Load sessions from the database (status will be Dead — used to restore layout on startup).
#[tauri::command]
pub async fn get_persisted_sessions(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
) -> Result<Vec<SessionInfo>, String> {
    let db_sessions = state.db.load_sessions(&workspace_id)?;
    Ok(db_sessions.iter().map(SessionInfo::from).collect())
}

/// Delete persisted sessions from DB for a workspace (used after restoring them on startup).
#[tauri::command]
pub async fn clear_persisted_sessions(
    state: State<'_, Arc<AppState>>,
    _workspace_id: String,
    session_ids: Vec<String>,
) -> Result<(), String> {
    for id in &session_ids {
        let _ = state.db.delete_session(id);
    }
    Ok(())
}

/// Persist a user-assigned name for a session tab.
#[tauri::command]
pub async fn rename_session(
    state: State<'_, Arc<AppState>>,
    session_id: String,
    name: Option<String>,
) -> Result<(), String> {
    // Update in-memory session
    let mut sessions = state.sessions.lock().await;
    if let Some(s) = sessions.iter_mut().find(|s| s.id == session_id) {
        s.name = name.clone();
    }
    drop(sessions);
    // Persist to DB
    state.db.rename_session(&session_id, name.as_deref())
}

#[tauri::command]
pub async fn update_session_status(
    state: State<'_, Arc<AppState>>,
    session_id: String,
    status: String,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().await;
    if let Some(session) = sessions.iter_mut().find(|s| s.id == session_id) {
        session.status = match status.as_str() {
            "idle" => SessionStatus::Idle,
            "running" => SessionStatus::Running,
            "waiting" => SessionStatus::Waiting,
            "error" => SessionStatus::Error,
            "dead" => SessionStatus::Dead,
            _ => return Err(format!("Invalid status: {status}")),
        };
        // Don't re-persist ephemeral (scratch) sessions — a status write must not
        // resurrect a DB row we deliberately keep out of the database.
        if !is_ephemeral_workspace(&session.workspace_id) {
            let _ = state.db.save_session(session);
        }
    }
    Ok(())
}

// === Workspace Commands ===

#[tauri::command]
pub async fn create_workspace(
    state: State<'_, Arc<AppState>>,
    name: String,
) -> Result<Workspace, String> {
    let id = Uuid::new_v4().to_string();
    let workspace = Workspace::new(id, name);
    state.db.save_workspace(&workspace)?;
    Ok(workspace)
}

#[tauri::command]
pub async fn get_workspaces(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<Workspace>, String> {
    state.db.load_workspaces()
}

#[tauri::command]
pub async fn delete_workspace(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
) -> Result<(), String> {
    // Kill all sessions in the workspace
    let sessions = state.sessions.lock().await;
    let session_ids: Vec<String> = sessions
        .iter()
        .filter(|s| s.workspace_id == workspace_id)
        .map(|s| s.id.clone())
        .collect();
    drop(sessions);

    for sid in &session_ids {
        // Clean up connect signals so buffering tasks unblock immediately
        let signal = state.connect_signals.lock().await.remove(sid);
        if let Some(tx) = signal {
            let _ = tx.send(());
        }
        let _ = state.pty_manager.kill_session(sid);
    }

    // Clean up worktrees before removing sessions
    {
        let sessions = state.sessions.lock().await;
        for s in sessions.iter().filter(|s| s.workspace_id == workspace_id) {
            if let Some(wt_path) = &s.worktree_path {
                if let Some(root) = WorktreeManager::git_root(&s.working_dir) {
                    let _ = WorktreeManager::remove_worktree(&root, wt_path);
                }
            }
        }
    }

    state.sessions.lock().await.retain(|s| s.workspace_id != workspace_id);
    state.db.delete_workspace(&workspace_id)
}

#[tauri::command]
pub async fn set_active_workspace(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
) -> Result<(), String> {
    state.db.set_active_workspace(&workspace_id)
}

#[tauri::command]
pub async fn save_layout(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    layout_json: String,
) -> Result<(), String> {
    state.db.save_layout(&workspace_id, &layout_json)
}

#[tauri::command]
pub async fn rename_workspace(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    name: String,
) -> Result<(), String> {
    let workspaces = state.db.load_workspaces()?;
    if let Some(mut ws) = workspaces.into_iter().find(|w| w.id == workspace_id) {
        ws.name = name;
        state.db.save_workspace(&ws)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn set_workspace_repo(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    repo_path: Option<String>,
) -> Result<(), String> {
    let workspaces = state.db.load_workspaces()?;
    if let Some(mut ws) = workspaces.into_iter().find(|w| w.id == workspace_id) {
        ws.repo_path = repo_path;
        state.db.save_workspace(&ws)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn create_workspace_with_repo(
    state: State<'_, Arc<AppState>>,
    name: String,
    repo_path: Option<String>,
) -> Result<Workspace, String> {
    let id = Uuid::new_v4().to_string();
    let mut workspace = Workspace::new(id, name);
    if let Some(ref path) = repo_path {
        workspace = workspace.with_repo(path.clone());
    }
    state.db.save_workspace(&workspace)?;
    Ok(workspace)
}

// === CLAUDE.md Management ===

#[tauri::command]
pub async fn read_claude_md(project_dir: String) -> Result<Option<String>, String> {
    let dir = validate_dir(&project_dir)?;
    let path = format!("{dir}/CLAUDE.md");
    match std::fs::read_to_string(&path) {
        Ok(content) => Ok(Some(content)),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub async fn write_claude_md(project_dir: String, content: String) -> Result<(), String> {
    let dir = validate_dir(&project_dir)?;
    let path = format!("{dir}/CLAUDE.md");
    atomic_write_string(Path::new(&path), &content)
}

// === Git Fetch ===

#[tauri::command]
pub async fn git_fetch(working_dir: String) -> Result<String, String> {
    let dir = validate_dir(&working_dir)?;
    run_git(&dir, &["fetch", "--all", "--prune"])
}

// === Git Stash ===

#[tauri::command]
pub async fn git_stash(working_dir: String, pop: bool) -> Result<String, String> {
    let dir = validate_dir(&working_dir)?;
    if pop {
        run_git(&dir, &["stash", "pop"])
    } else {
        run_git(&dir, &["stash"])
    }
}

// === Git Diff ===

#[tauri::command]
pub async fn git_diff_stat(working_dir: String) -> Result<String, String> {
    let dir = validate_dir(&working_dir)?;
    run_git(&dir, &["diff", "--stat"])
}

// === Code Review (Pro) ===

/// Unified diff to review for the active workspace: all uncommitted changes vs
/// HEAD. Falls back to staged/working-tree diffs when there is no HEAD yet.
#[tauri::command]
pub async fn get_active_diff(working_dir: String) -> Result<String, String> {
    let dir = validate_dir(&working_dir)?;
    match run_git(&dir, &["diff", "HEAD"]) {
        Ok(d) if !d.trim().is_empty() => Ok(d),
        Ok(_) => run_git(&dir, &["diff", "--cached"]),
        Err(_) => {
            // No commits yet (HEAD doesn't resolve): combine staged + unstaged.
            let staged = run_git(&dir, &["diff", "--cached"]).unwrap_or_default();
            let unstaged = run_git(&dir, &["diff"]).unwrap_or_default();
            Ok(format!("{staged}\n{unstaged}").trim().to_string())
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReviewFinding {
    pub severity: String,
    pub file: String,
    pub line: Option<i64>,
    pub title: String,
    pub why: String,
    pub fix: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReviewItem {
    pub dimension: String,
    pub label: String,
    pub summary: String,
    pub findings: Vec<ReviewFinding>,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReviewUsage {
    pub used: u32,
    pub limit: u32,
    pub remaining: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReviewResponse {
    pub reviews: Vec<ReviewItem>,
    #[serde(default)]
    pub truncated: bool,
    /// Friendly model name (e.g. "Claude Sonnet 4.6"), shown in the review header.
    #[serde(default)]
    pub model: Option<String>,
    /// Monthly review quota for this wallet (so the app can show "12/30 left").
    #[serde(default)]
    pub usage: Option<ReviewUsage>,
}

const DEFAULT_REVIEW_URL: &str = "https://grid-review.zippy-host.workers.dev";

/// Resolve the grid-review base URL: env override → DB setting → default.
/// (Override to http://127.0.0.1:8787 for local `wrangler dev` testing.)
fn review_base_url(state: &AppState) -> String {
    if let Ok(u) = std::env::var("GRID_REVIEW_URL") {
        let u = u.trim();
        if !u.is_empty() {
            return u.trim_end_matches('/').to_string();
        }
    }
    if let Some(u) = state.db.get_setting("grid_review_url") {
        let u = u.trim();
        if !u.is_empty() {
            return u.trim_end_matches('/').to_string();
        }
    }
    DEFAULT_REVIEW_URL.to_string()
}

/// Run a Pro code review on the active diff. Posts the diff + the entitlement
/// JWT to the grid-review Worker (which holds the model + provider key). The
/// model identity never reaches the client — only structured findings come back.
#[tauri::command]
pub async fn run_review(
    state: State<'_, Arc<AppState>>,
    working_dir: String,
    dimensions: Option<Vec<String>>,
) -> Result<ReviewResponse, String> {
    let diff = get_active_diff(working_dir).await?;
    if diff.trim().is_empty() {
        return Err("No changes to review. Make some edits first.".to_string());
    }

    let token = crate::entitlement::get_entitlement()?
        .ok_or_else(|| "Link your wallet (Settings → Premium) to use Reviews.".to_string())?;

    let url = format!("{}/review", review_base_url(&state));
    let body = serde_json::json!({
        "diff": diff,
        "dimensions": dimensions
            .unwrap_or_else(|| vec!["security".into(), "code".into(), "ux".into()]),
    });
    let body_str = serde_json::to_string(&body).map_err(|e| format!("encode request: {e}"))?;

    // Body + response go through temp files so a large diff never hits argv limits.
    let tmp_dir = std::env::temp_dir();
    let nonce = Uuid::new_v4();
    let req_path = tmp_dir.join(format!("codegrid-review-req-{nonce}.json"));
    let resp_path = tmp_dir.join(format!("codegrid-review-resp-{nonce}.json"));
    std::fs::write(&req_path, body_str.as_bytes()).map_err(|e| format!("write request: {e}"))?;

    // Keep the bearer token OUT of argv (it's readable via `ps`/Activity Monitor):
    // pass it through a 0600 curl config file referenced with -K.
    let cfg_path = tmp_dir.join(format!("codegrid-review-cfg-{nonce}.txt"));
    let cfg_contents = format!("header = \"Authorization: Bearer {token}\"\n");
    std::fs::write(&cfg_path, cfg_contents.as_bytes()).map_err(|e| {
        let _ = std::fs::remove_file(&req_path);
        format!("write auth config: {e}")
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&cfg_path, std::fs::Permissions::from_mode(0o600));
    }

    let req_arg = format!("@{}", req_path.to_string_lossy());
    let resp_str = resp_path.to_string_lossy().to_string();
    let cfg_str = cfg_path.to_string_lossy().to_string();
    let result = std::process::Command::new("curl")
        .args([
            "-sS",
            "-X",
            "POST",
            &url,
            "-K",
            &cfg_str,
            "-H",
            "content-type: application/json",
            "--data-binary",
            &req_arg,
            "-o",
            &resp_str,
            "-w",
            "%{http_code}",
        ])
        .output();

    let _ = std::fs::remove_file(&req_path);
    let _ = std::fs::remove_file(&cfg_path);

    let output = result.map_err(|e| {
        let _ = std::fs::remove_file(&resp_path);
        format!("Could not reach the review service: {e}")
    })?;

    let status = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let resp_body = std::fs::read_to_string(&resp_path).unwrap_or_default();
    let _ = std::fs::remove_file(&resp_path);

    if status == "200" {
        serde_json::from_str::<ReviewResponse>(&resp_body)
            .map_err(|_| "The review service returned an unreadable response.".to_string())
    } else if status == "429" {
        // grid-review returns 429 only for the monthly per-wallet review cap.
        let limit = serde_json::from_str::<serde_json::Value>(&resp_body)
            .ok()
            .and_then(|v| v.get("limit").and_then(|n| n.as_u64()))
            .unwrap_or(30);
        Err(format!(
            "You've used all {limit} of your Pro reviews this month — the limit resets on the 1st. (Coding analytics stays available.)"
        ))
    } else {
        // Map known statuses to safe messages — never surface the raw upstream body.
        let msg = match status.as_str() {
            "401" => "Your entitlement could not be verified. Re-link your wallet in Settings → Premium.",
            "403" => "Reviews require an active Pro stake.",
            "400" => "Nothing to review, or the request was malformed.",
            _ => "The review service is unavailable. Try again later.",
        };
        Err(msg.to_string())
    }
}

// === Utility Commands ===

#[tauri::command]
pub async fn get_git_branch(working_dir: String) -> Result<Option<String>, String> {
    let dir = validate_dir(&working_dir)?;
    Ok(WorktreeManager::current_branch(&dir))
}

#[tauri::command]
pub async fn is_git_repo(working_dir: String) -> Result<bool, String> {
    let dir = validate_dir(&working_dir)?;
    Ok(WorktreeManager::is_git_repo(&dir))
}

#[tauri::command]
pub async fn get_claude_path() -> Result<String, String> {
    which::which("claude")
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|_| "Claude Code not found. Install it with: npm install -g @anthropic-ai/claude-code".to_string())
}

/// Onboarding: which agent CLIs (and helpers) are installed on this machine,
/// and — best-effort — whether the user is signed in to each one.
///
/// Install is detected with `which`. Sign-in detection is uneven across
/// providers: Codex and Cursor expose a real status subcommand (exit 0 = authed),
/// while Claude, Gemini, and Grok have no clean status command, so we look for the
/// credential file the CLI writes after login, or the relevant API-key env var.
#[tauri::command]
pub async fn check_agent_clis() -> Result<serde_json::Value, String> {
    let has = |b: &str| which::which(b).is_ok();
    let env_set = |k: &str| std::env::var(k).map(|v| !v.trim().is_empty()).unwrap_or(false);
    let home = std::env::var("HOME").unwrap_or_default();
    let home_file = |rel: &str| !home.is_empty() && PathBuf::from(&home).join(rel).exists();

    // Run `<bin> <args...>` and treat exit code 0 as "signed in". Quick commands.
    let status_ok = |bin: &str, args: &[&str]| -> bool {
        std::process::Command::new(bin)
            .args(args)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    };

    // macOS stores Claude OAuth in the login Keychain rather than a file.
    let claude_keychain = cfg!(target_os = "macos")
        && std::process::Command::new("security")
            .args(["find-generic-password", "-s", "Claude Code-credentials"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);

    let claude_installed = has("claude");
    let codex_installed = has("codex");
    let gemini_installed = has("gemini");
    let cursor_installed = has("cursor-agent") || has("cursor");
    // Grok installs to ~/.grok/bin, which may not be on PATH during onboarding.
    let grok_installed = has("grok") || home_file(".grok/bin/grok");

    let claude_authed = claude_installed
        && (home_file(".claude/.credentials.json")
            || claude_keychain
            || env_set("ANTHROPIC_API_KEY")
            || env_set("ANTHROPIC_AUTH_TOKEN")
            || env_set("CLAUDE_CODE_OAUTH_TOKEN"));

    let codex_authed = codex_installed
        && (status_ok("codex", &["login", "status"])
            || home_file(".codex/auth.json")
            || env_set("OPENAI_API_KEY"));

    let gemini_authed = gemini_installed
        && (home_file(".gemini/oauth_creds.json")
            || env_set("GEMINI_API_KEY")
            || env_set("GOOGLE_API_KEY"));

    let cursor_authed = cursor_installed
        && (status_ok("cursor-agent", &["status"])
            || status_ok("agent", &["status"])
            || env_set("CURSOR_API_KEY"));

    let grok_authed = grok_installed
        && (home_file(".grok/auth.json") || env_set("XAI_API_KEY"));

    let agent = |installed: bool, logged_in: bool| {
        serde_json::json!({ "installed": installed, "logged_in": logged_in })
    };

    Ok(serde_json::json!({
        "claude": agent(claude_installed, claude_authed),
        "codex": agent(codex_installed, codex_authed),
        "gemini": agent(gemini_installed, gemini_authed),
        "cursor": agent(cursor_installed, cursor_authed),
        "grok": agent(grok_installed, grok_authed),
        "node": has("node"),
        "tmux": has("tmux"),
    }))
}

/// Onboarding: enable agent-to-agent collaboration by running the bundled
/// agent-bus installer, which configures every detected agent's MCP config.
#[tauri::command]
pub async fn setup_agent_bus(app: AppHandle) -> Result<String, String> {
    use tauri::Manager;
    // Find the agent-bus script: bundled resource first, dev path as fallback.
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(res) = app.path().resource_dir() {
        candidates.push(res.join("resources").join("agent-bus-mcp.cjs"));
        candidates.push(res.join("agent-bus-mcp.cjs"));
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("agent-bus-mcp.cjs"));
    let script = candidates
        .into_iter()
        .find(|p| p.exists())
        .ok_or_else(|| "Could not locate agent-bus-mcp.cjs in app resources.".to_string())?;

    let node = which::which("node")
        .map_err(|_| "Node.js not found. Install Node 18+ to enable agent collaboration.".to_string())?;

    let output = std::process::Command::new(node)
        .arg(&script)
        .arg("setup")
        .output()
        .map_err(|e| format!("Failed to run agent-bus setup: {e}"))?;

    let mut s = String::from_utf8_lossy(&output.stdout).to_string();
    let err = String::from_utf8_lossy(&output.stderr);
    if !err.trim().is_empty() {
        s.push('\n');
        s.push_str(&err);
    }
    Ok(s)
}

#[tauri::command]
pub async fn get_setting(
    state: State<'_, Arc<AppState>>,
    key: String,
) -> Result<Option<String>, String> {
    Ok(state.db.get_setting(&key))
}

#[tauri::command]
pub async fn set_setting(
    state: State<'_, Arc<AppState>>,
    key: String,
    value: String,
) -> Result<(), String> {
    // Block writes to security-sensitive keys — these are managed by
    // activate_license / deactivate_license and the trial system only.
    const BLOCKED_KEYS: &[&str] = &[
        "keyforge_license_key",
        "keyforge_status",
        "keyforge_last_validated",
        "keyforge_expires_at",
    ];
    if BLOCKED_KEYS.contains(&key.as_str()) {
        return Err(format!("Cannot modify protected setting: {key}"));
    }
    state.db.set_setting(&key, &value)
}

#[tauri::command]
pub async fn get_default_shell() -> Result<String, String> {
    #[cfg(unix)]
    {
        Ok(std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string()))
    }
    #[cfg(windows)]
    {
        Ok("powershell.exe".to_string())
    }
}

#[tauri::command]
pub async fn spawn_shell_session(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    working_dir: String,
    workspace_id: String,
) -> Result<SessionInfo, String> {
    let working_dir = validate_dir(&working_dir)?;
    let session_id = Uuid::new_v4().to_string();
    let pane_number = 1;

    let shell = get_default_shell().await?;
    let git_branch = if WorktreeManager::is_git_repo(&working_dir) {
        WorktreeManager::current_branch(&working_dir)
    } else {
        None
    };

    let mut rx = state.pty_manager.spawn_session(
        &session_id,
        &working_dir,
        &shell,
        &[],
        120,
        30,
    )?;

    let mut session = Session::new(
        session_id.clone(),
        workspace_id,
        working_dir,
        shell,
        pane_number,
    );
    session.git_branch = git_branch;
    session.status = SessionStatus::Running;

    {
        let mut sessions = state.sessions.lock().await;
        session.pane_number = sessions
            .iter()
            .filter(|s| s.workspace_id == session.workspace_id)
            .map(|s| s.pane_number)
            .max()
            .unwrap_or(0) + 1;
        sessions.push(session.clone());
    }
    // Ephemeral (scratch) sessions are never written to the DB.
    if !is_ephemeral_workspace(&session.workspace_id) {
        let _ = state.db.save_session(&session);
    }
    let info = SessionInfo::from(&session);

    // Buffer PTY output until frontend connects its event listeners
    let (connect_tx, connect_rx) = tokio::sync::oneshot::channel::<()>();
    state.connect_signals.lock().await.insert(session_id.clone(), connect_tx);

    let app_handle = app.clone();
    let state_for_task = state.inner().clone();
    let sid = session_id.clone();
    tokio::spawn(async move {
        // Wait for frontend to signal it's ready (or timeout after 5s as fallback)
        tokio::select! {
            _ = connect_rx => {},
            _ = tokio::time::sleep(std::time::Duration::from_secs(5)) => {},
        }

        while let Some(data) = rx.recv().await {
            let _ = app_handle.emit(
                "pty-output",
                PtyOutput {
                    session_id: sid.clone(),
                    data,
                },
            );
        }
        state_for_task.connect_signals.lock().await.remove(&sid);
        let _ = state_for_task.pty_manager.remove_session(&sid);
        {
            let mut sessions = state_for_task.sessions.lock().await;
            if let Some(s) = sessions.iter_mut().find(|s| s.id == sid) {
                s.status = SessionStatus::Dead;
            }
        }
        let _ = app_handle.emit(
            "session-ended",
            serde_json::json!({ "session_id": sid }),
        );
    });

    Ok(info)
}

// === Connect PTY (frontend signals it's ready to receive output) ===

#[tauri::command]
pub async fn connect_pty(
    state: State<'_, Arc<AppState>>,
    session_id: String,
) -> Result<(), String> {
    let signal = state.connect_signals.lock().await.remove(&session_id);
    if let Some(tx) = signal {
        let _ = tx.send(());
    }
    Ok(())
}

// === Git Clone Commands ===

#[tauri::command]
pub async fn clone_repo(
    app: AppHandle,
    url: String,
    target_dir: Option<String>,
) -> Result<String, String> {
    // Validate URL - must look like a git URL
    if !url.starts_with("https://") && !url.starts_with("git@") && !url.starts_with("ssh://") {
        return Err("Invalid URL: must start with https://, git@, or ssh://".to_string());
    }

    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let projects_dir = target_dir.unwrap_or_else(|| format!("{home}/Projects"));

    // Validate the target is under an allowed root BEFORE creating anything, so an
    // IPC caller can't get directories created outside home/`/tmp` ahead of rejection.
    let projects_dir_path = Path::new(&projects_dir);
    if !is_path_or_parent_within_allowed_roots(projects_dir_path) {
        return Err("Target directory must be under your home directory or /tmp".to_string());
    }
    // Create Projects dir if needed
    std::fs::create_dir_all(&projects_dir)
        .map_err(|e| format!("Failed to create directory: {e}"))?;
    if !is_path_within_allowed_roots(projects_dir_path) {
        return Err("Target directory must be under your home directory or /tmp".to_string());
    }

    // Extract repo name from URL and sanitize
    let repo_name = url
        .trim_end_matches('/')
        .trim_end_matches(".git")
        .rsplit('/')
        .next()
        .unwrap_or("repo")
        .to_string();

    // Reject repo names with path traversal
    if repo_name.contains("..") || repo_name.contains('/') || repo_name.contains('\\') || repo_name.is_empty() {
        return Err("Invalid repository name extracted from URL".to_string());
    }

    let clone_path = format!("{projects_dir}/{repo_name}");

    // If destination already exists, only allow it when it's already the same repo.
    if std::path::Path::new(&clone_path).exists() {
        let existing_remote = run_git(&clone_path, &["remote", "get-url", "origin"]).unwrap_or_default();
        if !existing_remote.trim().is_empty()
            && normalize_git_remote(&existing_remote) == normalize_git_remote(&url)
        {
            return Ok(clone_path);
        }
        return Err(format!(
            "Destination already exists at {clone_path}. Remove it or choose a different target directory."
        ));
    }

    let _ = app.emit("clone-progress", serde_json::json!({
        "status": "cloning",
        "repo": &repo_name,
    }));

    let env = shell_env();
    let output = std::process::Command::new("git")
        .args(["clone", &url, &clone_path])
        .envs(&env)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("Failed to run git clone: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let raw = if stderr.is_empty() { stdout } else { stderr };

        // If auth failed, try to configure git credentials via gh and retry once.
        if is_auth_error(&raw) && ensure_git_auth_ready(&env) {
            let retry = std::process::Command::new("git")
                .args(["clone", &url, &clone_path])
                .envs(&env)
                .env("GIT_TERMINAL_PROMPT", "0")
                .output()
                .map_err(|e| format!("Failed to rerun git clone: {e}"))?;
            if retry.status.success() {
                let _ = app.emit("clone-progress", serde_json::json!({
                    "status": "done",
                    "repo": &repo_name,
                    "path": &clone_path,
                }));
                return Ok(clone_path);
            }
            let retry_err = String::from_utf8_lossy(&retry.stderr).trim().to_string();
            return Err(format!("Clone failed: {}", classify_git_error(&retry_err)));
        }
        return Err(format!("Clone failed: {}", classify_git_error(&raw)));
    }

    let _ = app.emit("clone-progress", serde_json::json!({
        "status": "done",
        "repo": &repo_name,
        "path": &clone_path,
    }));

    Ok(clone_path)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitHubRepo {
    pub name: String,
    pub full_name: String,
    pub description: String,
    pub url: String,
    pub clone_url: String,
    pub stars: u32,
    pub language: String,
    pub updated_at: String,
    pub is_private: bool,
    pub is_fork: bool,
}

/// Resolve the `gh` binary path, checking common macOS/Linux install locations
/// so it works even when the app is launched from Finder/Dock (limited PATH).
///
/// NOTE: We explicitly do NOT mutate the process-wide PATH via `std::env::set_var`
/// because that is unsound in multi-threaded programs and can introduce PATH
/// injection risks. Instead we probe well-known directories directly.
fn resolve_gh_path() -> Result<String, String> {
    // Try the current PATH first
    if let Ok(p) = which::which("gh") {
        return Ok(p.to_string_lossy().to_string());
    }
    // Probe well-known install locations directly (no global state mutation)
    let extra_paths = [
        "/opt/homebrew/bin/gh",
        "/usr/local/bin/gh",
        "/usr/bin/gh",
        "/home/linuxbrew/.linuxbrew/bin/gh",
    ];
    for candidate in &extra_paths {
        let path = std::path::Path::new(candidate);
        if path.is_file() {
            return Ok(candidate.to_string());
        }
    }
    Err("GitHub CLI (gh) not found. Install with: brew install gh".to_string())
}

#[tauri::command]
pub async fn search_github_repos(
    query: String,
    limit: Option<u32>,
) -> Result<Vec<GitHubRepo>, String> {
    let gh_path = resolve_gh_path()?;

    let limit_str = (limit.unwrap_or(20)).to_string();

    // Sanitize query — allow characters used in GitHub search qualifiers
    // (e.g. "language:rust", "stars:>100", "user:foo", "topic:web+api"). Strip
    // leading hyphens/spaces so the query can't be parsed by gh as an option.
    let clean_query = query.replace(|c: char| !c.is_alphanumeric() && !"-_./ :><+@".contains(c), "");
    let clean_query = clean_query.trim_start_matches(['-', ' ']).to_string();
    if clean_query.is_empty() {
        return Ok(Vec::new());
    }

    // gh search repos uses different field names than gh repo list:
    //   language (string), stargazersCount, fullName
    let search_fields = "name,fullName,description,url,stargazersCount,language,updatedAt,isPrivate,isFork";

    let output = std::process::Command::new(&gh_path)
        .args([
            "search", "repos",
            &clean_query,
            "--json", search_fields,
            "--limit", &limit_str,
        ])
        .output()
        .map_err(|e| format!("Failed to run gh search: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Search failed: {stderr}"));
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    parse_gh_results(&json_str)
}

/// Parse JSON output from either `gh repo list` or `gh search repos`.
/// Handles field name differences between the two commands:
///   gh repo list:   nameWithOwner, stargazerCount, primaryLanguage (object)
///   gh search repos: fullName, stargazersCount, language (string)
fn parse_gh_results(json_str: &str) -> Result<Vec<GitHubRepo>, String> {
    let raw: Vec<serde_json::Value> = serde_json::from_str(json_str)
        .map_err(|e| format!("Failed to parse gh output: {e}"))?;

    Ok(raw.iter().map(|r| {
        // full_name: try fullName (search) then nameWithOwner (list)
        let full_name = r["fullName"].as_str()
            .or_else(|| r["nameWithOwner"].as_str())
            .unwrap_or("").to_string();

        // stars: try stargazersCount (search) then stargazerCount (list)
        let stars = r["stargazersCount"].as_u64()
            .or_else(|| r["stargazerCount"].as_u64())
            .unwrap_or(0) as u32;

        // language: try as string first (search), then as object with .name (list)
        let language = r["language"].as_str()
            .map(|s| s.to_string())
            .or_else(|| {
                r["primaryLanguage"].as_object()
                    .and_then(|l| l.get("name"))
                    .and_then(|n| n.as_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or_default();

        GitHubRepo {
            name: r["name"].as_str().unwrap_or("").to_string(),
            full_name,
            description: r["description"].as_str().unwrap_or("").to_string(),
            url: r["url"].as_str().unwrap_or("").to_string(),
            clone_url: r["url"].as_str().unwrap_or("").to_string(),
            stars,
            language,
            updated_at: r["updatedAt"].as_str().unwrap_or("").to_string(),
            is_private: r["isPrivate"].as_bool().unwrap_or(false),
            is_fork: r["isFork"].as_bool().unwrap_or(false),
        }
    }).collect())
}

#[tauri::command]
pub async fn list_github_repos(
    owner: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<GitHubRepo>, String> {
    let gh_path = resolve_gh_path()?;

    let limit_str = (limit.unwrap_or(100)).to_string();

    let mut args = vec![
        "repo".to_string(), "list".to_string(),
    ];
    if let Some(ref org) = owner {
        // Sanitize org/owner name. Strip disallowed chars, then strip leading
        // hyphens so a value like "--help" can't be parsed by gh as an option
        // instead of a positional owner argument.
        let clean = org
            .replace(|c: char| !c.is_alphanumeric() && c != '-' && c != '_', "");
        let clean = clean.trim_start_matches('-').to_string();
        if !clean.is_empty() {
            args.push(clean);
        }
    }
    args.extend_from_slice(&[
        "--json".to_string(), "name,nameWithOwner,description,url,stargazerCount,primaryLanguage,updatedAt,isPrivate,isFork".to_string(),
        "--limit".to_string(), limit_str,
    ]);

    let output = std::process::Command::new(&gh_path)
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to run gh: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("gh failed: {stderr}. Run 'gh auth login' to authenticate."));
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    parse_gh_results(&json_str)
}

#[tauri::command]
pub async fn get_home_dir() -> Result<String, String> {
    std::env::var("HOME").map_err(|_| "Could not determine home directory".to_string())
}

#[tauri::command]
pub async fn create_project_dir(name: String) -> Result<String, String> {
    let home = std::env::var("HOME")
        .map_err(|_| "Could not determine home directory".to_string())?;

    // Slugify: lowercase, replace spaces/underscores with hyphens, remove non-alphanumeric except hyphens
    let slug: String = name
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c == ' ' || c == '_' { '-' } else { c })
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect();

    // Collapse multiple hyphens and trim leading/trailing hyphens
    let slug = slug
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<&str>>()
        .join("-");

    if slug.is_empty() {
        return Err("Invalid project name: results in empty slug".to_string());
    }

    let projects_dir = format!("{home}/Projects");
    let project_path = format!("{projects_dir}/{slug}");

    // Create ~/Projects/ if it doesn't exist
    std::fs::create_dir_all(&project_path)
        .map_err(|e| format!("Failed to create project directory: {e}"))?;

    Ok(project_path)
}

/// Default folders to scan for projects when the user hasn't configured their
/// own. Includes the home directory itself (scanned one level deep) so users who
/// keep repos directly in ~ are covered out of the box. This used to be excluded
/// to avoid junk like ~/.oh-my-zsh / ~/.nvm, but `scan_roots_for_projects` now
/// skips dotfolders AND requires a real project marker (.git / package.json /
/// Cargo.toml / pyproject.toml), so those config clones no longer slip through.
fn default_project_roots() -> Vec<String> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let mut roots = vec![home.clone()];
    for sub in [
        "Projects",
        "projects",
        "Developer",
        "dev",
        "Code",
        "code",
        "repos",
        "src",
        "workspace",
        "Documents/GitHub",
        "GitHub",
    ] {
        roots.push(format!("{home}/{sub}"));
    }
    roots
}

/// Resolve the project search roots from settings, falling back to defaults.
fn resolve_search_roots(state: &State<'_, Arc<AppState>>) -> Vec<String> {
    if let Some(raw) = state.db.get_setting("project_search_roots") {
        if let Ok(roots) = serde_json::from_str::<Vec<String>>(&raw) {
            if !roots.is_empty() {
                return roots.iter().map(|r| expand_tilde(r)).collect();
            }
        }
    }
    default_project_roots()
}

/// Scan the given roots one level deep for project folders. Skips dotfolders
/// (e.g. ~/.config, ~/.oh-my-zsh) so config/tool clones never show as projects.
/// Returns (path, name, last_opened-iso) tuples sorted newest-first by mtime.
fn scan_roots_for_projects(roots: &[String]) -> Vec<(String, String, String)> {
    let mut found: Vec<(String, std::time::SystemTime)> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    for base in roots {
        let Ok(entries) = std::fs::read_dir(base) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            // Skip hidden / dotfolders outright.
            if path
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with('.'))
                .unwrap_or(true)
            {
                continue;
            }
            let is_project = path.join(".git").exists()
                || path.join("package.json").exists()
                || path.join("Cargo.toml").exists()
                || path.join("pyproject.toml").exists();
            if !is_project {
                continue;
            }
            if let Some(s) = path.to_str() {
                if seen.insert(s.to_string()) {
                    let mtime = std::fs::metadata(&path)
                        .and_then(|m| m.modified())
                        .unwrap_or(std::time::UNIX_EPOCH);
                    found.push((s.to_string(), mtime));
                }
            }
        }
    }

    found.sort_by(|a, b| b.1.cmp(&a.1));
    found.truncate(50);
    found
        .into_iter()
        .map(|(path, mtime)| {
            let name = Path::new(&path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(&path)
                .to_string();
            let iso = chrono::DateTime::<chrono::Utc>::from(mtime)
                .format("%Y-%m-%d %H:%M:%S")
                .to_string();
            (path, name, iso)
        })
        .collect()
}

/// Record that the user opened a project at `path`. This is the single source of
/// truth for "recent projects" — every open path (browse, quick-open, clone,
/// workspace-from-repo) should call this so the MRU reflects real usage.
#[tauri::command]
pub async fn record_recent_project(
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<(), String> {
    let trimmed = path.trim_end_matches('/');
    if trimmed.is_empty() {
        return Ok(());
    }
    let name = Path::new(trimmed)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(trimmed)
        .to_string();
    state.db.record_recent_project(trimmed, &name)
}

/// Primary launch-screen data source: the persisted MRU of opened projects.
/// On first ever call (empty + not yet seeded) it does a one-time filtered
/// filesystem scan to pre-populate, then never scans again.
#[tauri::command]
pub async fn list_recent_projects(
    state: State<'_, Arc<AppState>>,
    limit: Option<i64>,
) -> Result<Vec<crate::db::RecentProject>, String> {
    if state.db.get_setting("recent_projects_seeded").is_none() {
        // Merge the one-time scan into the MRU. seed_recent_projects uses
        // INSERT OR IGNORE, so this is safe even when a few recents already exist
        // (e.g. a project opened before the seed ran) — it won't clobber them.
        let roots = resolve_search_roots(&state);
        let seeds = scan_roots_for_projects(&roots);
        let _ = state.db.seed_recent_projects(&seeds);
        let _ = state.db.set_setting("recent_projects_seeded", "1");
    }
    state.db.list_recent_projects(limit.unwrap_or(24))
}

#[tauri::command]
pub async fn remove_recent_project(
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<(), String> {
    state.db.remove_recent_project(&path)
}

#[tauri::command]
pub async fn pin_recent_project(
    state: State<'_, Arc<AppState>>,
    path: String,
    pinned: bool,
) -> Result<(), String> {
    state.db.set_recent_project_pinned(&path, pinned)
}

/// Get the user-configured project search roots (used for first-run seeding and
/// the "Project folders" setting). Returns the resolved (tilde-expanded) list.
#[tauri::command]
pub async fn get_project_search_roots(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<String>, String> {
    if let Some(raw) = state.db.get_setting("project_search_roots") {
        if let Ok(roots) = serde_json::from_str::<Vec<String>>(&raw) {
            return Ok(roots);
        }
    }
    // Surface the defaults so the settings UI shows what's actually scanned.
    Ok(default_project_roots())
}

#[tauri::command]
pub async fn set_project_search_roots(
    state: State<'_, Arc<AppState>>,
    roots: Vec<String>,
) -> Result<(), String> {
    let json = serde_json::to_string(&roots).map_err(|e| format!("Failed to serialize: {e}"))?;
    state.db.set_setting("project_search_roots", &json)?;
    // Note: existing recents are left untouched. Use rescan_project_roots to
    // merge newly-configured folders into the MRU on demand.
    Ok(())
}

/// Re-scan the configured roots and merge any newly found projects into the MRU
/// without disturbing existing entries. Returns the refreshed list.
#[tauri::command]
pub async fn rescan_project_roots(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<crate::db::RecentProject>, String> {
    let roots = resolve_search_roots(&state);
    let seeds = scan_roots_for_projects(&roots);
    let _ = state.db.seed_recent_projects(&seeds);
    let _ = state.db.set_setting("recent_projects_seeded", "1");
    // Return the full MRU (the launch screen paginates with its own "View all"),
    // not a truncated 24 — otherwise a Rescan still hides projects past #24.
    state.db.list_recent_projects(500)
}

/// Deprecated: legacy filesystem-scan recents. Kept for backward compatibility;
/// now returns the persisted MRU paths instead of scanning $HOME.
#[tauri::command]
pub async fn list_recent_dirs(state: State<'_, Arc<AppState>>) -> Result<Vec<String>, String> {
    Ok(list_recent_projects(state, Some(50))
        .await?
        .into_iter()
        .map(|p| p.path)
        .collect())
}

// === Repo Quick Status (for project lists) ===

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RepoQuickStatus {
    pub is_git: bool,
    pub has_remote: bool,
    pub branch: Option<String>,
}

#[tauri::command]
pub async fn check_repo_status(path: String) -> Result<RepoQuickStatus, String> {
    let dir = match validate_dir(&path) {
        Ok(d) => d,
        Err(_) => return Ok(RepoQuickStatus { is_git: false, has_remote: false, branch: None }),
    };
    // Use rev-parse to detect git repos; this handles worktrees where .git is a file
    let is_git = run_git(&dir, &["rev-parse", "--is-inside-work-tree"])
        .map(|v| v == "true")
        .unwrap_or(false);
    if !is_git {
        return Ok(RepoQuickStatus { is_git: false, has_remote: false, branch: None });
    }
    let branch = run_git(&dir, &["rev-parse", "--abbrev-ref", "HEAD"]).ok();
    let remote_url = run_git(&dir, &["remote", "get-url", "origin"]).unwrap_or_default();
    let has_remote = !remote_url.is_empty();
    Ok(RepoQuickStatus { is_git: true, has_remote, branch })
}

// === GitHub Identity ===

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitHubIdentity {
    pub username: String,
    pub orgs: Vec<String>,
}

#[tauri::command]
pub async fn get_github_identity() -> Result<GitHubIdentity, String> {
    let gh_path = resolve_gh_path()?;

    let username = std::process::Command::new(&gh_path)
        .args(["api", "user", "--jq", ".login"])
        .output()
        .ok()
        .and_then(|o| if o.status.success() {
            Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
        } else { None })
        .unwrap_or_default();

    let orgs_output = std::process::Command::new(&gh_path)
        .args(["api", "user/orgs", "--jq", ".[].login"])
        .output()
        .ok()
        .and_then(|o| if o.status.success() {
            Some(String::from_utf8_lossy(&o.stdout).to_string())
        } else { None })
        .unwrap_or_default();

    let orgs: Vec<String> = orgs_output.lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();

    Ok(GitHubIdentity { username, orgs })
}

// === Claude Code Integration Commands ===

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SkillInfo {
    pub name: String,
    pub description: String,
    pub category: String,
    /// Which agent this skill belongs to:
    /// "claude" | "codex" | "cursor" | "gemini" | "grok".
    pub agent: String,
}

/// Parse `name:` and `description:` from the first YAML frontmatter block of a
/// SKILL.md (between the first pair of `---` fences). Handles quoted strings and
/// `>` / `|` block scalars. Returns (name, description); either may be empty.
fn parse_skill_frontmatter(content: &str) -> (Option<String>, Option<String>) {
    let mut lines = content.lines();
    // First non-empty line must be the opening fence.
    let mut started = false;
    for l in lines.by_ref() {
        if l.trim().is_empty() {
            continue;
        }
        if l.trim() == "---" {
            started = true;
        }
        break;
    }
    if !started {
        return (None, None);
    }

    let mut name: Option<String> = None;
    let mut description: Option<String> = None;
    let mut collecting_block: Option<String> = None; // which key's block scalar we're in
    let mut block_lines: Vec<String> = Vec::new();
    let mut base_indent: Option<usize> = None;

    let finish_block = |key: &str, block: &[String], name: &mut Option<String>, desc: &mut Option<String>| {
        let joined = block.iter().map(|s| s.trim()).collect::<Vec<_>>().join(" ");
        let joined = joined.trim().to_string();
        if !joined.is_empty() {
            match key {
                "name" => *name = Some(joined),
                "description" => *desc = Some(joined),
                _ => {}
            }
        }
    };

    for raw in lines {
        let line = raw;
        if line.trim() == "---" {
            // closing fence
            if let Some(ref key) = collecting_block {
                finish_block(key, &block_lines, &mut name, &mut description);
            }
            break;
        }

        // If inside a block scalar, accumulate indented continuation lines.
        if let Some(ref key) = collecting_block.clone() {
            let indent = line.len() - line.trim_start().len();
            let is_blank = line.trim().is_empty();
            if base_indent.is_none() && !is_blank {
                // First continuation line establishes the block's base indent.
                base_indent = Some(indent);
            }
            let bi = base_indent.unwrap_or(0);
            if is_blank || indent >= bi {
                block_lines.push(line.to_string());
                continue;
            } else {
                // block ended; flush and fall through to parse this line as a key.
                finish_block(key, &block_lines, &mut name, &mut description);
                collecting_block = None;
                block_lines.clear();
                base_indent = None;
            }
        }

        let trimmed = line.trim_start();
        // Only handle top-level keys (no leading indent) of interest.
        if line.len() != trimmed.len() {
            continue; // nested key, ignore
        }
        let (key, rest) = match trimmed.split_once(':') {
            Some((k, v)) => (k.trim(), v.trim()),
            None => continue,
        };
        if key != "name" && key != "description" {
            continue;
        }
        if rest == ">" || rest == "|" || rest == ">-" || rest == "|-" || rest == ">+" || rest == "|+" {
            collecting_block = Some(key.to_string());
            block_lines.clear();
            base_indent = None; // set on first continuation line
            continue;
        }
        let value = rest.trim().trim_matches('"').trim_matches('\'').to_string();
        if value.is_empty() {
            continue;
        }
        match key {
            "name" => name = Some(value),
            "description" => description = Some(value),
            _ => {}
        }
    }

    // For block scalars we may have entered but the first continuation line sets
    // base_indent: detect it lazily here is complex, so set it when pushing.
    let _ = base_indent;
    (name, description)
}

/// Scan a directory of `<name>/SKILL.md` skill folders, appending each discovered
/// skill (deduped by canonical path and by display name within the agent).
fn scan_skill_dirs(
    out: &mut Vec<SkillInfo>,
    seen_paths: &mut std::collections::HashSet<std::path::PathBuf>,
    root: &str,
    agent: &str,
    category: &str,
    skip_hidden: bool,
) {
    let entries = match std::fs::read_dir(root) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let dir_name = dir.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if skip_hidden && dir_name.starts_with('.') {
            continue; // e.g. Codex's .system dir
        }
        let skill_file = dir.join("SKILL.md");
        if !skill_file.exists() {
            continue;
        }
        // Resolve symlinks so the same shared skill (~/.agents/skills/<name>) is
        // only listed once per agent — many entries symlink into ~/.agents/skills.
        let canon = skill_file.canonicalize().unwrap_or_else(|_| skill_file.clone());
        if !seen_paths.insert(canon.clone()) {
            continue; // already counted this exact file in this agent's pass
        }
        let content = std::fs::read_to_string(&skill_file).unwrap_or_default();
        let (fm_name, fm_desc) = parse_skill_frontmatter(&content);
        let name = fm_name.unwrap_or_else(|| dir_name.to_string());
        // Dedupe by display name within this agent.
        if out.iter().any(|s| s.agent == agent && s.name == name) {
            continue;
        }
        let description = fm_desc
            .map(|d| d.chars().take(160).collect::<String>())
            .unwrap_or_else(|| "Skill".to_string());
        out.push(SkillInfo { name, description, category: category.to_string(), agent: agent.to_string() });
    }
}

/// Scan a directory of flat `<name>.md` command files (Claude slash commands).
fn scan_command_files(out: &mut Vec<SkillInfo>, root: &str, agent: &str, category: &str) {
    let entries = match std::fs::read_dir(root) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.extension().is_some_and(|e| e == "md") {
            continue;
        }
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
        if stem.is_empty() {
            continue;
        }
        let name = format!("/{stem}");
        if out.iter().any(|s| s.agent == agent && s.name == name) {
            continue;
        }
        let content = std::fs::read_to_string(&path).unwrap_or_default();
        let (_, fm_desc) = parse_skill_frontmatter(&content);
        let description = fm_desc.or_else(|| {
            content.lines()
                .find(|l| !l.trim().is_empty() && !l.starts_with('#') && !l.starts_with("---"))
                .map(|l| l.trim().chars().take(120).collect::<String>())
        }).unwrap_or_else(|| "Slash command".to_string());
        out.push(SkillInfo { name, description, category: category.to_string(), agent: agent.to_string() });
    }
}

/// Built-in Claude Code slash commands (not on disk).
fn builtin_claude_commands() -> Vec<SkillInfo> {
    let mk = |name: &str, desc: &str, cat: &str| SkillInfo {
        name: name.to_string(), description: desc.to_string(), category: cat.to_string(), agent: "claude".to_string(),
    };
    vec![
        mk("/help", "Get help with Claude Code", "General"),
        mk("/clear", "Clear conversation history", "General"),
        mk("/compact", "Compact conversation to save context", "General"),
        mk("/cost", "Show token usage and costs", "General"),
        mk("/doctor", "Check Claude Code health and config", "General"),
        mk("/config", "Open or edit configuration", "General"),
        mk("/login", "Log in to Anthropic", "General"),
        mk("/logout", "Log out of current account", "General"),
        mk("/status", "Show session status and info", "General"),
        mk("/vim", "Toggle vim keybindings", "General"),
        mk("/permissions", "View or modify tool permissions", "General"),
        mk("/terminal-setup", "Configure terminal integration", "General"),
        mk("/mcp", "Manage MCP server connections", "General"),
        mk("/init", "Initialize CLAUDE.md project file", "Project"),
        mk("/memory", "Save info to project memory", "Project"),
        mk("/add-dir", "Add a directory to context", "Project"),
        mk("/review", "Review code changes", "Coding"),
        mk("/bug", "Report or investigate a bug", "Coding"),
        mk("/pr-comments", "Address PR review comments", "Coding"),
        mk("/commit", "Commit staged changes with a message", "Coding"),
        mk("/model", "Switch or display current model", "Models"),
        mk("/fast", "Toggle fast mode (faster output)", "Models"),
    ]
}

/// Aggregate skills across all supported agents, each entry tagged with `agent`.
#[tauri::command]
pub async fn detect_all_skills(project_dir: Option<String>) -> Result<Vec<SkillInfo>, String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let mut skills: Vec<SkillInfo> = Vec::new();

    let validated_dir = match &project_dir {
        Some(pdir) => validate_dir(pdir).ok(),
        None => None,
    };

    // ===== CLAUDE =====
    skills.extend(builtin_claude_commands());
    {
        // Per-agent canonical-path dedupe set.
        let mut seen: std::collections::HashSet<std::path::PathBuf> = std::collections::HashSet::new();
        scan_skill_dirs(&mut skills, &mut seen, &format!("{home}/.claude/skills"), "claude", "Custom", true);
        // Plugin marketplace skills: ~/.claude/plugins/marketplaces/*/skills/*/SKILL.md
        if let Ok(markets) = std::fs::read_dir(format!("{home}/.claude/plugins/marketplaces")) {
            for m in markets.flatten() {
                let p = m.path();
                if p.is_dir() {
                    scan_skill_dirs(&mut skills, &mut seen, &format!("{}/skills", p.display()), "claude", "Plugin", true);
                }
            }
        }
        // Project skills.
        if let Some(ref dir) = validated_dir {
            scan_skill_dirs(&mut skills, &mut seen, &format!("{dir}/skills"), "claude", "Project", true);
            scan_skill_dirs(&mut skills, &mut seen, &format!("{dir}/.claude/skills"), "claude", "Project", true);
        }
    }
    // Slash commands (flat .md).
    scan_command_files(&mut skills, &format!("{home}/.claude/commands"), "claude", "Custom");

    // ===== CODEX =====
    {
        let mut seen: std::collections::HashSet<std::path::PathBuf> = std::collections::HashSet::new();
        scan_skill_dirs(&mut skills, &mut seen, &format!("{home}/.codex/skills"), "codex", "Custom", true); // skips .system
    }

    // ===== CURSOR (skills-cursor is primary; merge skills, dedupe by name) =====
    {
        let mut seen: std::collections::HashSet<std::path::PathBuf> = std::collections::HashSet::new();
        scan_skill_dirs(&mut skills, &mut seen, &format!("{home}/.cursor/skills-cursor"), "cursor", "Custom", true);
        scan_skill_dirs(&mut skills, &mut seen, &format!("{home}/.cursor/skills"), "cursor", "Custom", true);
    }

    // ===== GEMINI (none on this machine — returns empty gracefully) =====
    {
        let mut seen: std::collections::HashSet<std::path::PathBuf> = std::collections::HashSet::new();
        scan_skill_dirs(&mut skills, &mut seen, &format!("{home}/.gemini/skills"), "gemini", "Custom", true);
    }

    // ===== GROK =====
    {
        let mut seen: std::collections::HashSet<std::path::PathBuf> = std::collections::HashSet::new();
        scan_skill_dirs(&mut skills, &mut seen, &format!("{home}/.grok/skills"), "grok", "Custom", true);
        scan_skill_dirs(&mut skills, &mut seen, &format!("{home}/.grok/bundled/skills"), "grok", "Bundled", true);
    }

    Ok(skills)
}

/// Back-compat: original single-agent command, now delegates to the aggregator
/// and returns only Claude entries.
#[tauri::command]
pub async fn detect_claude_skills() -> Result<Vec<SkillInfo>, String> {
    let all = detect_all_skills(None).await?;
    Ok(all.into_iter().filter(|s| s.agent == "claude").collect())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub speed: String,
    pub tier: String,
}

#[tauri::command]
pub async fn get_available_models() -> Result<Vec<ModelInfo>, String> {
    Ok(vec![
        ModelInfo {
            id: "claude-opus-4-6".to_string(),
            name: "Opus 4.6".to_string(),
            description: "Most capable. Best for complex reasoning and architecture.".to_string(),
            speed: "Slower".to_string(),
            tier: "max".to_string(),
        },
        ModelInfo {
            id: "claude-sonnet-4-6".to_string(),
            name: "Sonnet 4.6".to_string(),
            description: "Fast and capable. Great balance of speed and quality.".to_string(),
            speed: "Fast".to_string(),
            tier: "high".to_string(),
        },
        ModelInfo {
            id: "claude-haiku-4-5".to_string(),
            name: "Haiku 4.5".to_string(),
            description: "Fastest and cheapest. Good for simple tasks.".to_string(),
            speed: "Fastest".to_string(),
            tier: "standard".to_string(),
        },
    ])
}

#[tauri::command]
pub async fn send_to_session(
    state: State<'_, Arc<AppState>>,
    session_id: String,
    text: String,
) -> Result<(), String> {
    let data = format!("{text}\n");
    state.pty_manager.write_to_pty(&session_id, data.as_bytes())
}

#[tauri::command]
pub async fn dir_exists(path: String) -> Result<bool, String> {
    let expanded = expand_tilde(&path);
    let p = std::path::Path::new(&expanded);

    // Only allow probing directories under home or /tmp
    let home = std::env::var("HOME").unwrap_or_default();
    if !home.is_empty() && !expanded.starts_with(&home) && !expanded.starts_with("/tmp") {
        return Ok(false);
    }
    if expanded.contains("..") {
        return Ok(false);
    }

    Ok(p.is_dir())
}

// === Git Manager Commands ===

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitStatusInfo {
    pub branch: String,
    pub ahead: u32,
    pub behind: u32,
    pub staged: Vec<GitFileChange>,
    pub unstaged: Vec<GitFileChange>,
    pub untracked: Vec<String>,
    pub has_remote: bool,
    pub remote_url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitFileChange {
    pub path: String,
    pub status: String, // "modified", "added", "deleted", "renamed"
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitLogEntry {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub author: String,
    pub date: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitBranchInfo {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
    pub last_commit: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct GitBlameEntry {
    pub hash: String,
    pub author: String,
    pub date: String,
    pub line_number: u32,
    pub content: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct GitStashEntry {
    pub index: u32,
    pub message: String,
}

fn validate_branch_name(name: &str) -> Result<(), String> {
    if name.starts_with('-') {
        return Err("Invalid branch name: must not start with '-'".to_string());
    }
    if name.contains(|c: char| " \t\n\r$`|;&<>(){}".contains(c)) {
        return Err("Invalid branch name: contains special characters".to_string());
    }
    Ok(())
}

fn validate_commit_hash(hash: &str) -> Result<(), String> {
    if hash.is_empty() {
        return Err("Commit hash must not be empty".to_string());
    }
    if !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Invalid commit hash: must be hexadecimal".to_string());
    }
    Ok(())
}

fn validate_dir(dir: &str) -> Result<String, String> {
    let expanded = expand_tilde(dir);
    let path = Path::new(&expanded);
    if !path.is_dir() {
        return Err(format!("Directory does not exist: {expanded}"));
    }
    // Canonicalize to resolve symlinks and ".." components
    let canonical = path.canonicalize()
        .map_err(|e| format!("Invalid path: {e}"))?;
    if !is_path_within_allowed_roots(&canonical) {
        return Err("Access denied: path must be under your home directory or /tmp".to_string());
    }

    let canonical_str = canonical.to_str()
        .ok_or_else(|| "Path contains invalid characters".to_string())?;
    Ok(canonical_str.to_string())
}

fn validate_file_path(file_path: &str) -> Result<(), String> {
    // Reject path traversal attempts
    if file_path.contains("..") || file_path.starts_with('/') || file_path.starts_with('\\') {
        return Err("Invalid file path: path traversal not allowed".to_string());
    }
    // Reject paths starting with '-' which could be interpreted as git flags
    if file_path.starts_with('-') {
        return Err("Invalid file path: must not start with '-'".to_string());
    }
    // Reject null bytes
    if file_path.contains('\0') {
        return Err("Invalid file path: contains null byte".to_string());
    }
    Ok(())
}

/// Atomically write a string to `path` by writing a temp file in the same
/// directory and renaming over the target. This prevents a crash or power loss
/// mid-write from corrupting a precious config file such as `~/.claude.json`,
/// where a truncated/partial write would break the user's entire Claude setup.
fn atomic_write_string(path: &Path, contents: &str) -> Result<(), String> {
    let tmp = path.with_extension(format!(
        "tmp.{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    std::fs::write(&tmp, contents.as_bytes()).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Failed to write temp file: {e}")
    })?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Failed to save file: {e}")
    })?;
    Ok(())
}

/// Build a shell login environment so that git can find SSH agents,
/// credential helpers, and other tools that live outside the default
/// macOS-app PATH (e.g. /opt/homebrew/bin, ~/.nix-profile/bin).
/// The result is cached after the first call to avoid spawning a login
/// shell on every git invocation.
fn shell_env() -> std::collections::HashMap<String, String> {
    use std::sync::OnceLock;
    static CACHED_ENV: OnceLock<std::collections::HashMap<String, String>> = OnceLock::new();

    CACHED_ENV.get_or_init(|| {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        let mut env: std::collections::HashMap<String, String> = std::env::vars().collect();

        if let Ok(output) = std::process::Command::new(&shell)
            .args(["-l", "-c", "env"])
            .output()
        {
            if output.status.success() {
                let out = String::from_utf8_lossy(&output.stdout);
                for line in out.lines() {
                    if let Some((k, v)) = line.split_once('=') {
                        env.insert(k.to_string(), v.to_string());
                    }
                }
            }
        }

        // Ensure critical vars are always present
        if !env.contains_key("HOME") {
            if let Ok(h) = std::env::var("HOME") {
                env.insert("HOME".into(), h);
            }
        }

        // On macOS, SSH_AUTH_SOCK is managed by launchd and may not appear in
        // the login shell env. Try launchctl to find it so SSH-based git remotes work.
        #[cfg(target_os = "macos")]
        if env.get("SSH_AUTH_SOCK").map(|v| v.is_empty()).unwrap_or(true) {
            if let Ok(out) = std::process::Command::new("launchctl")
                .args(["getenv", "SSH_AUTH_SOCK"])
                .output()
            {
                let sock = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !sock.is_empty() {
                    env.insert("SSH_AUTH_SOCK".into(), sock);
                }
            }
        }

        env
    }).clone()
}

/// Map raw git stderr to a user-friendly message (mirrors VS Code's GitErrorCodes pattern).
fn classify_git_error(msg: &str) -> String {
    let m = msg.to_lowercase();
    if m.contains("authentication failed") || m.contains("invalid username or password") || m.contains("could not read username") {
        format!("Authentication failed. Make sure you're logged in to GitHub (run `gh auth login` in a terminal).\n\nDetails: {msg}")
    } else if m.contains("permission denied (publickey)") || m.contains("public key") {
        format!("SSH key not found or not authorized. Add your key with `ssh-add ~/.ssh/id_ed25519` in a terminal.\n\nDetails: {msg}")
    } else if m.contains("no upstream branch") || m.contains("has no upstream") {
        "No upstream branch set. The first push will set it automatically — try pushing again.".to_string()
    } else if m.contains("rejected") && m.contains("non-fast-forward") {
        "Push rejected: remote has changes you don't have locally. Pull first, then push.".to_string()
    } else if m.contains("rejected") {
        format!("Push rejected by remote.\n\nDetails: {msg}")
    } else if m.contains("repository not found") || m.contains("does not exist") {
        "Repository not found. Check that the remote URL is correct and you have access.".to_string()
    } else if m.contains("connection") || m.contains("unable to connect") || m.contains("could not resolve host") {
        "Network error: could not reach GitHub. Check your internet connection.".to_string()
    } else if m.contains("need to specify how to reconcile divergent branches") || m.contains("divergent branches") {
        "Local and remote have diverged. Pull will merge remote changes into your branch; resolve any conflicts, then push again.".to_string()
    } else if m.contains("did not match any file(s) known to git") || m.contains("unknown revision or path not in the working tree") {
        "Branch not found locally or on origin. Fetch first or check the branch name.".to_string()
    } else if m.contains("would be overwritten by checkout") {
        "Cannot switch branches: your local changes would be overwritten. Commit, stash, or discard changes first.".to_string()
    } else if m.contains("conflict") {
        "Merge conflict. Resolve conflicts in the files and commit.".to_string()
    } else {
        msg.to_string()
    }
}

fn is_auth_error(msg: &str) -> bool {
    let m = msg.to_lowercase();
    m.contains("authentication failed")
        || m.contains("invalid username or password")
        || m.contains("could not read username")
        || m.contains("terminal prompts disabled")
        || m.contains("permission denied")
        || m.contains("could not authenticate")
}

fn normalize_git_remote(url: &str) -> String {
    let mut u = url.trim().trim_end_matches('/').to_string();
    if let Some(stripped) = u.strip_suffix(".git") {
        u = stripped.to_string();
    }
    u.to_lowercase()
}

fn ensure_git_auth_ready(env: &std::collections::HashMap<String, String>) -> bool {
    let gh_path = match resolve_gh_path() {
        Ok(p) => p,
        Err(_) => return false,
    };

    let auth_ok = std::process::Command::new(&gh_path)
        .args(["auth", "status"])
        .envs(env)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if !auth_ok {
        return false;
    }

    std::process::Command::new(&gh_path)
        .args(["auth", "setup-git"])
        .envs(env)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(test)]
mod git_auth_helpers_tests {
    use super::{is_auth_error, normalize_git_remote};

    #[test]
    fn normalizes_git_remotes_for_comparison() {
        assert_eq!(
            normalize_git_remote("https://github.com/Owner/Repo.git"),
            normalize_git_remote("https://github.com/owner/repo/")
        );
    }

    #[test]
    fn detects_common_auth_failures() {
        assert!(is_auth_error("fatal: could not read Username for 'https://github.com': terminal prompts disabled"));
        assert!(is_auth_error("remote: Authentication failed"));
        assert!(!is_auth_error("Already up to date."));
    }
}

fn run_git(dir: &str, args: &[&str]) -> Result<String, String> {
    let env = shell_env();
    let output = std::process::Command::new("git")
        .args(args)
        .current_dir(dir)
        .envs(&env)
        // Prevent git from prompting for credentials via TTY -- this is a GUI app
        // with no attached terminal, so a prompt would hang the process indefinitely.
        .env("GIT_TERMINAL_PROMPT", "0")
        // Disable GUI/SSH askpass and credential-manager prompts so a missing
        // credential or key passphrase fails fast instead of hanging forever.
        .env("GIT_ASKPASS", "/bin/false")
        .env("SSH_ASKPASS", "/bin/false")
        .env("GCM_INTERACTIVE", "never")
        // Don't wait on index/ref locks held by another process.
        .env("GIT_OPTIONAL_LOCKS", "0")
        // Treat all path arguments as literal paths, never pathspec magic. Without
        // this, a file literally named `:(top)` or containing glob magic could make
        // a file-scoped op (stage/discard/diff) act on the whole worktree.
        .env("GIT_LITERAL_PATHSPECS", "1")
        .output()
        .map_err(|e| format!("Failed to run git: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let msg = if stderr.trim().is_empty() { stdout } else { stderr };
        return Err(msg.trim().to_string());
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    // Git push/pull/fetch write useful output (progress, remote info) to stderr
    // even on success. When stdout is empty, return stderr content instead so
    // callers can see what actually happened.
    if stdout.is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if !stderr.is_empty() {
            return Ok(stderr);
        }
    }
    Ok(stdout)
}

#[tauri::command]
pub async fn git_status(working_dir: String) -> Result<GitStatusInfo, String> {
    let dir = validate_dir(&working_dir)?;

    let branch = run_git(&dir, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_default();

    // Ahead/behind
    let (ahead, behind) = {
        let ab = run_git(&dir, &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]).unwrap_or_default();
        let parts: Vec<&str> = ab.split_whitespace().collect();
        (
            parts.first().and_then(|s| s.parse().ok()).unwrap_or(0u32),
            parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0u32),
        )
    };

    // Porcelain status
    let status_out = run_git(&dir, &["status", "--porcelain=v1"])?;
    let mut staged = Vec::new();
    let mut unstaged = Vec::new();
    let mut untracked = Vec::new();

    for line in status_out.lines() {
        if line.len() < 3 { continue; }
        let index = line.chars().next().unwrap_or(' ');
        let work = line.chars().nth(1).unwrap_or(' ');
        let raw_path = line[3..].to_string();

        // For renames/copies (R/C), porcelain v1 format is "old -> new"; use the new name
        let path = if index == 'R' || index == 'C' {
            raw_path.rsplit(" -> ").next().unwrap_or(&raw_path).to_string()
        } else {
            raw_path
        };

        if index == '?' {
            untracked.push(path);
            continue;
        }
        // Handle merge conflicts (UU, AA, DD, AU, UA, DU, UD)
        if index == 'U' || work == 'U' || (index == 'A' && work == 'A') || (index == 'D' && work == 'D') {
            unstaged.push(GitFileChange {
                path,
                status: "conflict".to_string(),
            });
            continue;
        }
        if index != ' ' && index != '?' {
            staged.push(GitFileChange {
                path: path.clone(),
                status: match index {
                    'A' => "added", 'D' => "deleted",
                    'R' => "renamed", 'C' => "copied", _ => "modified",
                }.to_string(),
            });
        }
        if work != ' ' && work != '?' {
            unstaged.push(GitFileChange {
                path,
                status: match work {
                    'D' => "deleted", _ => "modified",
                }.to_string(),
            });
        }
    }

    // Remote URL
    let remote_url = run_git(&dir, &["remote", "get-url", "origin"]).unwrap_or_default();
    let has_remote = !remote_url.is_empty();

    Ok(GitStatusInfo { branch, ahead, behind, staged, unstaged, untracked, has_remote, remote_url })
}

#[tauri::command]
pub async fn git_push(working_dir: String, set_upstream: bool) -> Result<String, String> {
    let dir = validate_dir(&working_dir)?;
    let branch = run_git(&dir, &["rev-parse", "--abbrev-ref", "HEAD"])?;

    // Check if there is an upstream tracking branch configured
    let has_upstream = run_git(&dir, &["rev-parse", "--abbrev-ref", &format!("{branch}@{{upstream}}")]).is_ok();

    // Use run_git_push which sets GIT_TERMINAL_PROMPT=0 to prevent hangs
    // when credentials are unavailable (no TTY in a GUI app).
    let args: Vec<&str> = if set_upstream || !has_upstream {
        vec!["push", "-u", "origin", &branch]
    } else {
        vec!["push"]
    };

    let env = shell_env();
    let output = std::process::Command::new("git")
        .args(&args)
        .current_dir(&dir)
        .envs(&env)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("Failed to run git push: {e}"))?;

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

    if !output.status.success() {
        let raw = if stderr.is_empty() { &stdout } else { &stderr };
        if is_auth_error(raw) && ensure_git_auth_ready(&env) {
            let retry = std::process::Command::new("git")
                .args(&args)
                .current_dir(&dir)
                .envs(&env)
                .env("GIT_TERMINAL_PROMPT", "0")
                .output()
                .map_err(|e| format!("Failed to rerun git push: {e}"))?;
            let retry_stderr = String::from_utf8_lossy(&retry.stderr).trim().to_string();
            let retry_stdout = String::from_utf8_lossy(&retry.stdout).trim().to_string();
            if retry.status.success() {
                let retry_result = if retry_stdout.is_empty() && !retry_stderr.is_empty() {
                    retry_stderr
                } else if !retry_stdout.is_empty() {
                    retry_stdout
                } else {
                    "Push completed".to_string()
                };
                return Ok(retry_result);
            }
            let retry_raw = if retry_stderr.is_empty() { &retry_stdout } else { &retry_stderr };
            return Err(classify_git_error(retry_raw));
        }
        return Err(classify_git_error(raw));
    }

    // git push writes all its output (progress, remote info) to stderr.
    // Return stderr so the frontend knows what happened.
    let result = if stdout.is_empty() && !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        "Push completed".to_string()
    };
    Ok(result)
}

#[tauri::command]
pub async fn git_pull(working_dir: String) -> Result<String, String> {
    let dir = validate_dir(&working_dir)?;
    let pull_args = ["pull", "--no-rebase"];
    match run_git(&dir, &pull_args) {
        Ok(v) => Ok(v),
        Err(e) => {
            if is_auth_error(&e) {
                let env = shell_env();
                if ensure_git_auth_ready(&env) {
                    return run_git(&dir, &pull_args).map_err(|e2| classify_git_error(&e2));
                }
            }
            Err(classify_git_error(&e))
        }
    }
}

#[tauri::command]
pub async fn git_commit(working_dir: String, message: String, stage_all: bool) -> Result<String, String> {
    let dir = validate_dir(&working_dir)?;
    if stage_all {
        run_git(&dir, &["add", "-A"])?;
    }
    run_git(&dir, &["commit", "-m", &message])
}

#[tauri::command]
pub async fn git_stage_file(working_dir: String, file_path: String) -> Result<(), String> {
    let dir = validate_dir(&working_dir)?;
    validate_file_path(&file_path)?;
    run_git(&dir, &["add", &file_path])?;
    Ok(())
}

#[tauri::command]
pub async fn git_unstage_file(working_dir: String, file_path: String) -> Result<(), String> {
    let dir = validate_dir(&working_dir)?;
    validate_file_path(&file_path)?;
    // "reset HEAD" fails in repos with no commits; fall back to "rm --cached"
    if run_git(&dir, &["reset", "HEAD", "--", &file_path]).is_err() {
        run_git(&dir, &["rm", "--cached", "--", &file_path])?;
    }
    Ok(())
}

#[tauri::command]
pub async fn git_create_branch(working_dir: String, branch_name: String, checkout: bool) -> Result<(), String> {
    let dir = validate_dir(&working_dir)?;
    // Validate branch name - reject shell metacharacters
    if branch_name.starts_with('-') {
        return Err("Invalid branch name: must not start with '-'".to_string());
    }
    if branch_name.contains(|c: char| " \t\n\r$`|;&<>(){}".contains(c)) {
        return Err("Invalid branch name: contains special characters".to_string());
    }
    if checkout {
        run_git(&dir, &["checkout", "-b", &branch_name])?;
    } else {
        run_git(&dir, &["branch", &branch_name])?;
    }
    Ok(())
}

#[tauri::command]
pub async fn git_switch_branch(working_dir: String, branch_name: String) -> Result<(), String> {
    let dir = validate_dir(&working_dir)?;
    // Validate branch name - reject shell metacharacters and flag-like names
    if branch_name.starts_with('-') {
        return Err("Invalid branch name: must not start with '-'".to_string());
    }
    if branch_name.contains(|c: char| " \t\n\r$`|;&<>(){}".contains(c)) {
        return Err("Invalid branch name: contains special characters".to_string());
    }
    run_git(&dir, &["checkout", &branch_name])?;
    Ok(())
}

#[tauri::command]
pub async fn git_list_branches(working_dir: String) -> Result<Vec<GitBranchInfo>, String> {
    let dir = validate_dir(&working_dir)?;

    let current = run_git(&dir, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_default();

    // Local branches (may be empty in repos with no commits)
    let local_out = run_git(&dir, &["branch", "--format=%(refname:short)\t%(objectname:short)\t%(subject)"]).unwrap_or_default();
    let mut branches: Vec<GitBranchInfo> = local_out
        .lines()
        .filter(|l| !l.is_empty())
        .map(|line| {
            let parts: Vec<&str> = line.splitn(3, '\t').collect();
            GitBranchInfo {
                name: parts.first().unwrap_or(&"").to_string(),
                is_current: parts.first().unwrap_or(&"") == &current,
                is_remote: false,
                last_commit: parts.get(2).unwrap_or(&"").to_string(),
            }
        })
        .collect();

    // Remote branches
    let remote_out = run_git(&dir, &["branch", "-r", "--format=%(refname:short)\t%(objectname:short)\t%(subject)"]).unwrap_or_default();
    for line in remote_out.lines() {
        if line.is_empty() || line.contains("HEAD") { continue; }
        let parts: Vec<&str> = line.splitn(3, '\t').collect();
        let name = parts.first().unwrap_or(&"").to_string();
        // Skip symbolic refs like origin/HEAD which %(refname:short) resolves to just
        // the remote name (e.g. "origin") without a slash -- not a real branch.
        if !name.contains('/') { continue; }
        // Skip if local branch exists with matching name (e.g. "origin/main" -> "main")
        let short_name = name.split('/').skip(1).collect::<Vec<_>>().join("/");
        if branches.iter().any(|b| b.name == short_name) { continue; }
        branches.push(GitBranchInfo {
            name,
            is_current: false,
            is_remote: true,
            last_commit: parts.get(2).unwrap_or(&"").to_string(),
        });
    }

    Ok(branches)
}

#[tauri::command]
pub async fn git_log(working_dir: String, count: u32) -> Result<Vec<GitLogEntry>, String> {
    let dir = validate_dir(&working_dir)?;
    let n = format!("-{}", count.min(50));
    // In empty repos (no commits yet), git log exits with an error; return empty list.
    // Use ASCII record separator (\x1e) as delimiter instead of tab, because commit
    // messages can contain tab characters which would break tab-delimited parsing.
    let out = match run_git(&dir, &["log", &n, "--format=%H%x1e%h%x1e%s%x1e%an%x1e%cr"]) {
        Ok(o) => o,
        Err(_) => return Ok(Vec::new()),
    };

    Ok(out
        .lines()
        .filter(|l| !l.is_empty())
        .map(|line| {
            let parts: Vec<&str> = line.splitn(5, '\x1e').collect();
            GitLogEntry {
                hash: parts.first().unwrap_or(&"").to_string(),
                short_hash: parts.get(1).unwrap_or(&"").to_string(),
                message: parts.get(2).unwrap_or(&"").to_string(),
                author: parts.get(3).unwrap_or(&"").to_string(),
                date: parts.get(4).unwrap_or(&"").to_string(),
            }
        })
        .collect())
}

#[tauri::command]
pub async fn git_discard_file(working_dir: String, file_path: String) -> Result<(), String> {
    let dir = validate_dir(&working_dir)?;
    validate_file_path(&file_path)?;
    // Try checkout first (works for tracked modified files)
    if run_git(&dir, &["checkout", "--", &file_path]).is_err() {
        // For untracked files, checkout fails; remove the file directly
        let full_path = std::path::Path::new(&dir).join(&file_path);
        if full_path.exists() {
            // Verify the resolved path is still under the working directory
            let canonical = full_path.canonicalize()
                .map_err(|e| format!("Cannot resolve path: {e}"))?;
            let dir_canonical = std::path::Path::new(&dir).canonicalize()
                .map_err(|e| format!("Cannot resolve dir: {e}"))?;
            if !canonical.starts_with(&dir_canonical) {
                return Err("Path escapes working directory".to_string());
            }
            if full_path.is_dir() {
                std::fs::remove_dir_all(&full_path)
                    .map_err(|e| format!("Failed to remove directory: {e}"))?;
            } else {
                std::fs::remove_file(&full_path)
                    .map_err(|e| format!("Failed to remove file: {e}"))?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn git_diff_file(working_dir: String, file_path: String, staged: bool) -> Result<String, String> {
    let dir = validate_dir(&working_dir)?;
    validate_file_path(&file_path)?;

    // Try to get diff first
    let result = if staged {
        run_git(&dir, &["diff", "--cached", "--", &file_path])
    } else {
        run_git(&dir, &["diff", "--", &file_path])
    };

    match result {
        Ok(diff) if !diff.is_empty() => Ok(diff),
        _ => {
            // For untracked files or empty diff, try to show file content as all-additions
            let full_path = std::path::Path::new(&dir).join(&file_path);
            if full_path.exists() {
                // Resolve symlinks and verify the file stays under the repo root, so a
                // symlinked entry can't make the diff viewer read files outside the repo.
                let canonical = full_path.canonicalize()
                    .map_err(|e| format!("Cannot resolve path: {e}"))?;
                let dir_canonical = std::path::Path::new(&dir).canonicalize()
                    .map_err(|e| format!("Cannot resolve dir: {e}"))?;
                if !canonical.starts_with(&dir_canonical) {
                    return Err("Path escapes working directory".to_string());
                }
                // Guard against extremely large files consuming too much memory
                let meta = std::fs::metadata(&canonical)
                    .map_err(|e| format!("Failed to stat file: {e}"))?;
                if meta.len() > MAX_FILE_SIZE {
                    return Err(format!("File too large ({:.1} MB)", meta.len() as f64 / (1024.0 * 1024.0)));
                }
                let content = std::fs::read_to_string(&canonical)
                    .map_err(|e| format!("Failed to read file: {e}"))?;
                let lines: Vec<String> = content.lines().map(|l| format!("+{l}")).collect();
                let header = format!(
                    "--- /dev/null\n+++ b/{}\n@@ -0,0 +1,{} @@\n{}",
                    file_path,
                    lines.len(),
                    lines.join("\n")
                );
                Ok(header)
            } else {
                Ok("(file deleted)".to_string())
            }
        }
    }
}

#[tauri::command]
pub async fn git_stage_all(working_dir: String) -> Result<(), String> {
    let dir = validate_dir(&working_dir)?;
    run_git(&dir, &["add", "-A"])?;
    Ok(())
}

#[tauri::command]
pub async fn git_show_commit(working_dir: String, hash: String) -> Result<String, String> {
    let dir = validate_dir(&working_dir)?;
    // Validate commit hash - only allow hex chars
    if hash.is_empty() || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Invalid commit hash".to_string());
    }
    run_git(&dir, &["show", "--stat", "--format=%H%n%an <%ae>%n%cr%n%n%s%n%n%b", &hash])
}

// === Quick Publish / Save Commands ===

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QuickPublishResult {
    pub success: bool,
    pub message: String,
    pub commit_hash: String,
    pub files_changed: u32,
}

/// Generate a human-friendly commit message from the list of changed files.
fn generate_commit_message(dir: &str) -> String {
    let stat = run_git(dir, &["diff", "--cached", "--stat"]).unwrap_or_default();
    let files: Vec<&str> = stat.lines()
        .filter(|l| l.contains('|'))
        .map(|l| l.split('|').next().unwrap_or("").trim())
        .filter(|f| !f.is_empty())
        .collect();

    if files.is_empty() {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        return format!("Update {ts}");
    }

    let short_names: Vec<String> = files.iter()
        .map(|f| f.rsplit('/').next().unwrap_or(f).to_string())
        .collect();

    match short_names.len() {
        1 => format!("Update {}", short_names[0]),
        2 => format!("Update {} and {}", short_names[0], short_names[1]),
        n => format!("Update {}, {}, and {} other files", short_names[0], short_names[1], n - 2),
    }
}

#[tauri::command]
pub async fn quick_publish(dir: String) -> Result<QuickPublishResult, String> {
    let dir = validate_dir(&dir)?;

    // Verify this is a git repo
    run_git(&dir, &["rev-parse", "--is-inside-work-tree"])
        .map_err(|_| "This folder is not a git repository.".to_string())?;

    // Check for a remote
    let remote_url = run_git(&dir, &["remote", "get-url", "origin"]).unwrap_or_default();
    if remote_url.trim().is_empty() {
        return Err("No remote configured. Connect to GitHub first.".to_string());
    }

    // Stage all changes
    run_git(&dir, &["add", "-A"])
        .map_err(|e| format!("Failed to stage changes: {e}"))?;

    // Check what's staged via diff --cached --stat
    let diff_stat = run_git(&dir, &["diff", "--cached", "--stat"]).unwrap_or_default();
    let total_files = diff_stat.lines().filter(|l| l.contains('|')).count() as u32;

    if total_files == 0 {
        return Ok(QuickPublishResult {
            success: true,
            message: "No changes to publish.".to_string(),
            commit_hash: String::new(),
            files_changed: 0,
        });
    }

    // Generate commit message
    let message = generate_commit_message(&dir);

    // Commit
    run_git(&dir, &["commit", "-m", &message])
        .map_err(|e| format!("Failed to commit: {e}"))?;

    // Get commit hash
    let commit_hash = run_git(&dir, &["rev-parse", "--short", "HEAD"]).unwrap_or_default();

    // Push (with upstream setup if needed)
    let branch = run_git(&dir, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_else(|_| "main".to_string());
    let has_upstream = run_git(&dir, &["rev-parse", "--abbrev-ref", &format!("{branch}@{{upstream}}")]).is_ok();

    let push_args: Vec<&str> = if has_upstream {
        vec!["push"]
    } else {
        vec!["push", "-u", "origin", &branch]
    };

    let env = shell_env();
    let output = std::process::Command::new("git")
        .args(&push_args)
        .current_dir(&dir)
        .envs(&env)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("Failed to push: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let raw = if stderr.is_empty() { &stdout } else { &stderr };
        if is_auth_error(raw) && ensure_git_auth_ready(&env) {
            let retry = std::process::Command::new("git")
                .args(&push_args)
                .current_dir(&dir)
                .envs(&env)
                .env("GIT_TERMINAL_PROMPT", "0")
                .output()
                .map_err(|e| format!("Failed to rerun push: {e}"))?;
            if !retry.status.success() {
                let retry_stderr = String::from_utf8_lossy(&retry.stderr).trim().to_string();
                let retry_stdout = String::from_utf8_lossy(&retry.stdout).trim().to_string();
                let retry_raw = if retry_stderr.is_empty() { &retry_stdout } else { &retry_stderr };
                return Err(classify_git_error(retry_raw));
            }
            return Ok(QuickPublishResult {
                success: true,
                message: format!("Published! {} file{} saved to GitHub.", total_files, if total_files == 1 { "" } else { "s" }),
                commit_hash,
                files_changed: total_files,
            });
        }
        return Err(classify_git_error(raw));
    }

    Ok(QuickPublishResult {
        success: true,
        message: format!("Published! {} file{} saved to GitHub.", total_files, if total_files == 1 { "" } else { "s" }),
        commit_hash,
        files_changed: total_files,
    })
}

#[tauri::command]
pub async fn quick_save(dir: String) -> Result<QuickPublishResult, String> {
    let dir = validate_dir(&dir)?;

    // Verify this is a git repo
    run_git(&dir, &["rev-parse", "--is-inside-work-tree"])
        .map_err(|_| "This folder is not a git repository.".to_string())?;

    // Stage all changes
    run_git(&dir, &["add", "-A"])
        .map_err(|e| format!("Failed to stage changes: {e}"))?;

    // Check what's staged
    let diff_stat = run_git(&dir, &["diff", "--cached", "--stat"]).unwrap_or_default();
    let total_files = diff_stat.lines().filter(|l| l.contains('|')).count() as u32;

    if total_files == 0 {
        return Ok(QuickPublishResult {
            success: true,
            message: "No changes to save.".to_string(),
            commit_hash: String::new(),
            files_changed: 0,
        });
    }

    // Generate commit message
    let message = generate_commit_message(&dir);

    // Commit
    run_git(&dir, &["commit", "-m", &message])
        .map_err(|e| format!("Failed to commit: {e}"))?;

    // Get commit hash
    let commit_hash = run_git(&dir, &["rev-parse", "--short", "HEAD"]).unwrap_or_default();

    Ok(QuickPublishResult {
        success: true,
        message: format!("Saved! {} file{} committed.", total_files, if total_files == 1 { "" } else { "s" }),
        commit_hash,
        files_changed: total_files,
    })
}

// === File Tree Commands ===

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileEntry>>,
    pub is_gitignored: bool,
}

/// Entries that are ALWAYS hidden from the file tree, regardless of .gitignore.
/// These are either enormous (would explode the tree) or pure noise that is
/// never useful to browse. Everything else — including gitignored files and
/// folders — is shown (dimmed), so users can see what won't be committed.
const HARD_SKIP: &[&str] = &[
    ".git", "node_modules", "target", "__pycache__", "venv", ".venv", ".DS_Store",
];

/// Simple gitignore pattern matcher.  Supports:
///   - exact file/dir names  (e.g. `coverage`)
///   - leading wildcard       (e.g. `*.log`)
///   - trailing slash dirs    (e.g. `logs/`)
///   - negation lines are skipped (lines starting with `!`)
///   - comment lines starting with `#`
fn parse_gitignore(root: &str) -> Vec<String> {
    let path = format!("{root}/.gitignore");
    match std::fs::read_to_string(&path) {
        Ok(content) => content
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty() && !l.starts_with('#') && !l.starts_with('!'))
            .map(|l| l.trim_end_matches('/').to_string())
            .collect(),
        Err(_) => Vec::new(),
    }
}

fn matches_gitignore(name: &str, patterns: &[String]) -> bool {
    for pat in patterns {
        if pat == name {
            return true;
        }
        // Leading wildcard (e.g. "*.log")
        if let Some(suffix) = pat.strip_prefix('*') {
            if name.ends_with(suffix) {
                return true;
            }
        }
        // Trailing wildcard (e.g. ".env.*")
        if let Some(prefix) = pat.strip_suffix('*') {
            if name.starts_with(prefix) {
                return true;
            }
        }
        // Path-based patterns (e.g. "src-tauri/gen"):
        // match if the last path component equals the name.
        if pat.contains('/') {
            if let Some(last) = pat.rsplit('/').next() {
                if !last.is_empty() && last == name {
                    return true;
                }
            }
        }
    }
    false
}

fn build_file_tree(
    dir: &str,
    depth: u32,
    max_depth: u32,
    gitignore_patterns: &[String],
    parent_ignored: bool,
) -> Vec<FileEntry> {
    if depth >= max_depth {
        return Vec::new();
    }

    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };

    let mut dirs: Vec<FileEntry> = Vec::new();
    let mut files: Vec<FileEntry> = Vec::new();

    let root_canonical = std::path::Path::new(dir).canonicalize().unwrap_or_else(|_| std::path::PathBuf::from(dir));

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();

        // Hard-skip the enormous / never-browse entries (.git, node_modules, …).
        if HARD_SKIP.contains(&name.as_str()) {
            continue;
        }

        // Skip symlinks that resolve outside the allowed root
        if let Ok(ft) = entry.file_type() {
            if ft.is_symlink() {
                if let Ok(resolved) = entry.path().canonicalize() {
                    if !resolved.starts_with(&root_canonical) {
                        continue;
                    }
                } else {
                    continue; // broken symlink
                }
            }
        }

        // Gitignored entries are SHOWN (so users can see what won't be committed),
        // just flagged so the UI can dim them. Anything inside an ignored folder
        // inherits the ignored state.
        let is_gitignored = parent_ignored || matches_gitignore(&name, gitignore_patterns);

        let path = format!("{dir}/{name}");
        let is_dir = entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false);

        if is_dir {
            // For directories, children are loaded lazily on the frontend.
            // Only pre-load children for shallow depths to keep initial load fast.
            let children = if depth + 1 < max_depth {
                Some(build_file_tree(&path, depth + 1, max_depth, gitignore_patterns, is_gitignored))
            } else {
                // Signal that this dir has potential children (non-empty marker)
                None
            };
            dirs.push(FileEntry {
                name,
                path,
                is_dir: true,
                children,
                is_gitignored,
            });
        } else {
            files.push(FileEntry {
                name,
                path,
                is_dir: false,
                children: None,
                is_gitignored,
            });
        }
    }

    // Sort: directories first, then files, alphabetical within each
    dirs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    dirs.extend(files);
    dirs
}

/// Collect gitignore patterns from the given directory and all parent directories
/// up to the repository root (or filesystem root).
fn collect_gitignore_patterns(dir: &str) -> Vec<String> {
    let mut patterns = Vec::new();
    let mut current = std::path::PathBuf::from(dir);
    loop {
        let gi = current.join(".gitignore");
        if gi.exists() {
            patterns.extend(parse_gitignore(current.to_str().unwrap_or("")));
        }
        // Stop at repository root (has .git dir) or filesystem root
        if current.join(".git").is_dir() || !current.pop() {
            break;
        }
    }
    patterns.sort();
    patterns.dedup();
    patterns
}

#[tauri::command]
pub async fn list_directory(path: String, max_depth: Option<u32>) -> Result<Vec<FileEntry>, String> {
    let dir = validate_dir(&path)?;
    let depth_limit = max_depth.unwrap_or(3).min(6); // cap at 6 to prevent huge trees
    let gitignore_patterns = collect_gitignore_patterns(&dir);
    Ok(build_file_tree(&dir, 0, depth_limit, &gitignore_patterns, false))
}

#[tauri::command]
pub async fn create_folder(parent_path: String, folder_name: String) -> Result<String, String> {
    let parent = validate_dir(&parent_path)?;
    let name = folder_name.trim();
    if name.is_empty() {
        return Err("Folder name cannot be empty".to_string());
    }
    if name == "." || name == ".." || name.contains('/') || name.contains('\\') || name.contains('\0') {
        return Err("Invalid folder name".to_string());
    }

    let parent_canonical = std::path::Path::new(&parent)
        .canonicalize()
        .map_err(|e| format!("Cannot resolve parent path: {e}"))?;
    let new_path = parent_canonical.join(name);
    if !new_path.starts_with(&parent_canonical) {
        return Err("Invalid folder path".to_string());
    }

    std::fs::create_dir_all(&new_path)
        .map_err(|e| format!("Failed to create folder: {e}"))?;

    let final_path = new_path.to_str()
        .ok_or_else(|| "Created folder path has invalid characters".to_string())?;
    Ok(final_path.to_string())
}

// === MCP Manager Commands ===

fn validate_mcp_config_path(config_path: &str) -> Result<(), String> {
    let expanded = expand_tilde(config_path);
    let path = Path::new(&expanded);

    // Reject null bytes and path traversal early
    if expanded.contains('\0') || expanded.contains("..") {
        return Err("MCP config path must not contain path traversal".to_string());
    }
    if !expanded.ends_with(".json") {
        return Err("MCP config path must be a .json file".to_string());
    }

    // Only allow known MCP config file names. `settings.json` is included for
    // Gemini (~/.gemini/settings.json) whose mcpServers live there. TOML configs
    // (Codex/Grok) are deliberately NOT writable and never reach this path.
    let file_name = path.file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Invalid MCP config filename".to_string())?;
    if file_name != "mcp.json"
        && file_name != ".mcp.json"
        && file_name != ".claude.json"
        && file_name != "settings.json"
    {
        return Err("MCP config filename must be mcp.json, .mcp.json, .claude.json, or settings.json".to_string());
    }

    if !is_path_or_parent_within_allowed_roots(path) {
        return Err("MCP config path must be under your home directory or /tmp".to_string());
    }

    Ok(())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct McpServerConfig {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: std::collections::HashMap<String, String>,
    pub enabled: bool,
    pub scope: String, // "global", "project"
    pub source_file: String,
    #[serde(rename = "type")]
    pub server_type: String, // "stdio" or "http"
    #[serde(default)]
    pub url: Option<String>,
    /// Which agent CLI this server belongs to:
    /// "claude" | "codex" | "cursor" | "gemini" | "grok".
    pub agent: String,
    /// Whether this entry can be edited/removed through the app.
    /// True for JSON-backed agents (claude/cursor/gemini); false for TOML
    /// (codex/grok) which are view-only here.
    pub writable: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct McpConfigFile {
    #[serde(rename = "mcpServers", default)]
    pub mcp_servers: std::collections::HashMap<String, McpServerEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct McpServerEntry {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,
    #[serde(default, skip_serializing_if = "std::collections::HashMap::is_empty")]
    pub env: std::collections::HashMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disabled: Option<bool>,
    #[serde(rename = "type", default, skip_serializing_if = "Option::is_none")]
    pub server_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub headers: Option<std::collections::HashMap<String, String>>,
}

/// Strip single-line (//) and multi-line (/* */) comments from JSON text,
/// without modifying string literals.
fn strip_json_comments(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let chars: Vec<char> = input.chars().collect();
    let len = chars.len();
    let mut i = 0usize;
    let mut in_string = false;
    let mut escape = false;

    while i < len {
        if escape {
            result.push(chars[i]);
            escape = false;
            i += 1;
            continue;
        }
        if in_string {
            if chars[i] == '\\' {
                escape = true;
            } else if chars[i] == '"' {
                in_string = false;
            }
            result.push(chars[i]);
            i += 1;
            continue;
        }
        if chars[i] == '"' {
            in_string = true;
            result.push('"');
            i += 1;
        } else if i + 1 < len && chars[i] == '/' && chars[i + 1] == '/' {
            while i < len && chars[i] != '\n' {
                i += 1;
            }
        } else if i + 1 < len && chars[i] == '/' && chars[i + 1] == '*' {
            i += 2;
            while i + 1 < len && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            if i + 1 < len {
                i += 2;
            }
        } else {
            result.push(chars[i]);
            i += 1;
        }
    }
    result
}

fn read_mcp_file(path: &str) -> Option<McpConfigFile> {
    let content = std::fs::read_to_string(path).ok()?;
    let cleaned = strip_json_comments(&content);
    serde_json::from_str(&cleaned).ok()
}

/// Build an McpServerConfig from a parsed JSON-style entry.
fn mcp_from_entry(
    name: &str,
    entry: &McpServerEntry,
    scope: &str,
    source_file: &str,
    agent: &str,
    writable: bool,
) -> McpServerConfig {
    let stype = entry.server_type.clone().unwrap_or_else(|| {
        if entry.url.is_some() { "http".to_string() } else { "stdio".to_string() }
    });
    McpServerConfig {
        name: name.to_string(),
        command: entry.command.clone().unwrap_or_default(),
        args: entry.args.clone(),
        env: entry.env.clone(),
        enabled: !entry.disabled.unwrap_or(false),
        scope: scope.to_string(),
        source_file: source_file.to_string(),
        server_type: stype,
        url: entry.url.clone(),
        agent: agent.to_string(),
        writable,
    }
}

/// Push servers from a JSON mcpServers file, skipping duplicates already present
/// for the same (agent, name, scope) so the same store isn't listed twice.
fn push_json_mcp_file(
    out: &mut Vec<McpServerConfig>,
    path: &str,
    scope: &str,
    agent: &str,
    writable: bool,
) {
    if let Some(config) = read_mcp_file(path) {
        for (name, entry) in &config.mcp_servers {
            if out.iter().any(|s| s.agent == agent && s.name == *name && s.scope == scope) {
                continue;
            }
            out.push(mcp_from_entry(name, entry, scope, path, agent, writable));
        }
    }
}

// --- TOML config readers (Codex + Grok) ---------------------------------

#[derive(Debug, Deserialize)]
struct TomlMcpRoot {
    #[serde(default)]
    mcp_servers: std::collections::HashMap<String, TomlMcpServer>,
}

#[derive(Debug, Deserialize)]
struct TomlMcpServer {
    #[serde(default)]
    command: Option<String>,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    env: std::collections::HashMap<String, String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default, rename = "type")]
    server_type: Option<String>,
    #[serde(default)]
    headers: Option<std::collections::HashMap<String, String>>,
    #[serde(default)]
    disabled: Option<bool>,
}

/// Read `[mcp_servers.<name>]` blocks from a TOML config file (Codex / Grok).
/// These agents are view-only here (writable=false) — we never serialize TOML.
fn push_toml_mcp_file(
    out: &mut Vec<McpServerConfig>,
    path: &str,
    scope: &str,
    agent: &str,
) {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return,
    };
    let root: TomlMcpRoot = match toml::from_str(&content) {
        Ok(r) => r,
        Err(_) => return,
    };
    for (name, srv) in &root.mcp_servers {
        if out.iter().any(|s| s.agent == agent && s.name == *name && s.scope == scope) {
            continue;
        }
        let entry = McpServerEntry {
            command: srv.command.clone(),
            args: srv.args.clone(),
            env: srv.env.clone(),
            disabled: srv.disabled,
            server_type: srv.server_type.clone(),
            url: srv.url.clone(),
            headers: srv.headers.clone(),
        };
        out.push(mcp_from_entry(name, &entry, scope, path, agent, false));
    }
}

/// Read Claude's canonical ~/.claude.json — top-level `mcpServers` (global) AND
/// per-project `projects.<dir>.mcpServers` (project scope). This is where the
/// Claude CLI actually writes; the old reader missed the per-project map.
fn push_claude_json(out: &mut Vec<McpServerConfig>, path: &str, project_dir: Option<&str>) {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return,
    };
    let cleaned = strip_json_comments(&content);
    let doc: serde_json::Value = match serde_json::from_str(&cleaned) {
        Ok(v) => v,
        Err(_) => return,
    };

    // Top-level mcpServers → global scope.
    if let Some(servers) = doc.get("mcpServers").and_then(|v| v.as_object()) {
        for (name, val) in servers {
            if out.iter().any(|s| s.agent == "claude" && s.name == *name && s.scope == "global") {
                continue;
            }
            if let Ok(entry) = serde_json::from_value::<McpServerEntry>(val.clone()) {
                out.push(mcp_from_entry(name, &entry, "global", path, "claude", true));
            }
        }
    }

    // Per-project mcpServers → project scope. If a project_dir is provided, only
    // surface that project's servers; otherwise list them all (tagged by dir).
    if let Some(projects) = doc.get("projects").and_then(|v| v.as_object()) {
        for (proj_path, proj_val) in projects {
            if let Some(pd) = project_dir {
                if proj_path != pd {
                    continue;
                }
            }
            let Some(servers) = proj_val.get("mcpServers").and_then(|v| v.as_object()) else { continue };
            for (name, val) in servers {
                if out.iter().any(|s| s.agent == "claude" && s.name == *name && s.scope == "project") {
                    continue;
                }
                if let Ok(entry) = serde_json::from_value::<McpServerEntry>(val.clone()) {
                    // Note the originating project in source_file for clarity.
                    let src = format!("{path} (projects.{proj_path})");
                    out.push(mcp_from_entry(name, &entry, "project", &src, "claude", true));
                }
            }
        }
    }
}

#[tauri::command]
pub async fn list_mcps(project_dir: Option<String>) -> Result<Vec<McpServerConfig>, String> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let mut servers: Vec<McpServerConfig> = Vec::new();

    let validated_dir = match &project_dir {
        Some(pdir) => Some(validate_dir(pdir)?),
        None => None,
    };

    // ===== CLAUDE =====
    // Canonical store: ~/.claude.json (top-level + projects.<dir>.mcpServers).
    push_claude_json(
        &mut servers,
        &format!("{home}/.claude.json"),
        validated_dir.as_deref(),
    );
    // Convention copy used by this app: ~/.claude/mcp.json (global).
    push_json_mcp_file(&mut servers, &format!("{home}/.claude/mcp.json"), "global", "claude", true);
    // Project-scoped Claude files.
    if let Some(ref dir) = validated_dir {
        push_json_mcp_file(&mut servers, &format!("{dir}/.mcp.json"), "project", "claude", true);
        push_json_mcp_file(&mut servers, &format!("{dir}/.claude/mcp.json"), "project", "claude", true);
    }

    // ===== CODEX (TOML, view-only) =====
    push_toml_mcp_file(&mut servers, &format!("{home}/.codex/config.toml"), "global", "codex");
    if let Some(ref dir) = validated_dir {
        push_toml_mcp_file(&mut servers, &format!("{dir}/.codex/config.toml"), "project", "codex");
    }

    // ===== CURSOR (JSON) =====
    push_json_mcp_file(&mut servers, &format!("{home}/.cursor/mcp.json"), "global", "cursor", true);
    if let Some(ref dir) = validated_dir {
        push_json_mcp_file(&mut servers, &format!("{dir}/.cursor/mcp.json"), "project", "cursor", true);
    }

    // ===== GEMINI (JSON; mcpServers inside settings.json) =====
    push_json_mcp_file(&mut servers, &format!("{home}/.gemini/settings.json"), "global", "gemini", true);

    // ===== GROK (TOML native + JSON settings.json compat) =====
    push_toml_mcp_file(&mut servers, &format!("{home}/.grok/config.toml"), "global", "grok");
    push_json_mcp_file(&mut servers, &format!("{home}/.grok/settings.json"), "global", "grok", false);
    if let Some(ref dir) = validated_dir {
        push_toml_mcp_file(&mut servers, &format!("{dir}/.grok/config.toml"), "project", "grok");
    }

    Ok(servers)
}

#[tauri::command]
pub async fn save_mcp_config(
    config_path: String,
    servers: std::collections::HashMap<String, McpServerEntry>,
) -> Result<(), String> {
    validate_mcp_config_path(&config_path)?;

    // Ensure parent directory exists
    let path = Path::new(&config_path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {e}"))?;
    }

    // Preserve existing file structure if it exists
    let mut doc: serde_json::Value = if let Ok(content) = std::fs::read_to_string(&config_path) {
        let cleaned = strip_json_comments(&content);
        serde_json::from_str(&cleaned)
            .map_err(|e| format!("Failed to parse existing config: {e}"))?
    } else {
        serde_json::json!({})
    };

    let servers_value = serde_json::to_value(&servers)
        .map_err(|e| format!("Failed to serialize servers: {e}"))?;
    doc.as_object_mut()
        .ok_or("Config is not an object")?
        .insert("mcpServers".to_string(), servers_value);

    let json = serde_json::to_string_pretty(&doc)
        .map_err(|e| format!("Failed to serialize: {e}"))?;
    atomic_write_string(Path::new(&config_path), &format!("{json}\n"))?;
    Ok(())
}

#[tauri::command]
pub async fn toggle_mcp_server(
    config_path: String,
    server_name: String,
    enabled: bool,
) -> Result<(), String> {
    validate_mcp_config_path(&config_path)?;
    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config: {e}"))?;
    let cleaned = strip_json_comments(&content);
    let mut doc: serde_json::Value = serde_json::from_str(&cleaned)
        .map_err(|e| format!("Failed to parse config: {e}"))?;

    let servers = doc.get_mut("mcpServers")
        .and_then(|v| v.as_object_mut())
        .ok_or_else(|| format!("No mcpServers found in {config_path}"))?;

    let server = servers.get_mut(&server_name)
        .and_then(|v| v.as_object_mut())
        .ok_or_else(|| format!("Server '{server_name}' not found in {config_path}"))?;

    if enabled {
        server.remove("disabled");
    } else {
        server.insert("disabled".to_string(), serde_json::Value::Bool(true));
    }

    let json = serde_json::to_string_pretty(&doc)
        .map_err(|e| format!("Failed to serialize: {e}"))?;
    atomic_write_string(Path::new(&config_path), &format!("{json}\n"))?;
    Ok(())
}

#[tauri::command]
pub async fn remove_mcp_server(
    config_path: String,
    server_name: String,
) -> Result<(), String> {
    validate_mcp_config_path(&config_path)?;
    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config: {e}"))?;
    let cleaned = strip_json_comments(&content);
    let mut doc: serde_json::Value = serde_json::from_str(&cleaned)
        .map_err(|e| format!("Failed to parse config: {e}"))?;

    let servers = doc.get_mut("mcpServers")
        .and_then(|v| v.as_object_mut())
        .ok_or_else(|| format!("No mcpServers found in {config_path}"))?;

    if servers.remove(&server_name).is_none() {
        return Err(format!("Server '{server_name}' not found in {config_path}"));
    }

    let json = serde_json::to_string_pretty(&doc)
        .map_err(|e| format!("Failed to serialize: {e}"))?;
    atomic_write_string(Path::new(&config_path), &format!("{json}\n"))?;
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct AddMcpServerParams {
    pub config_path: String,
    pub name: String,
    pub command: Option<String>,
    pub args: Vec<String>,
    pub env: std::collections::HashMap<String, String>,
    pub url: Option<String>,
    pub server_type: Option<String>,
    pub headers: Option<std::collections::HashMap<String, String>>,
}

#[tauri::command]
pub async fn add_mcp_server(params: AddMcpServerParams) -> Result<(), String> {
    let AddMcpServerParams {
        config_path,
        name,
        command,
        args,
        env,
        url,
        server_type,
        headers,
    } = params;

    validate_mcp_config_path(&config_path)?;

    let name = name.trim();
    if name.is_empty() {
        return Err("Server name cannot be empty".to_string());
    }
    if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.') {
        return Err("Server name contains invalid characters".to_string());
    }

    // Must provide either command (stdio) or url (http)
    if command.is_none() && url.is_none() {
        return Err("Must provide either 'command' (stdio) or 'url' (http)".to_string());
    }

    // Validate command doesn't contain path traversal or shell tricks
    if let Some(ref cmd) = command {
        if cmd.contains("..") || cmd.contains(';') || cmd.contains('|') || cmd.contains('&')
            || cmd.contains('`') || cmd.contains("$(") || cmd.contains('\0') {
            return Err("Invalid command: contains prohibited characters".to_string());
        }
    }

    // Validate args don't contain shell injection characters
    for arg in &args {
        if arg.contains('\0') || arg.contains('`') || arg.contains("$(") {
            return Err("Invalid argument: contains prohibited characters".to_string());
        }
    }

    // Validate URL if provided
    if let Some(ref u) = url {
        if !u.starts_with("http://") && !u.starts_with("https://") {
            return Err("Invalid URL: must start with http:// or https://".to_string());
        }
    }

    let path = Path::new(&config_path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {e}"))?;
    }

    // Preserve existing file structure
    let mut doc: serde_json::Value = if let Ok(content) = std::fs::read_to_string(&config_path) {
        let cleaned = strip_json_comments(&content);
        serde_json::from_str(&cleaned)
            .map_err(|e| format!("Failed to parse existing config: {e}"))?
    } else {
        serde_json::json!({})
    };

    let new_entry = McpServerEntry {
        command,
        args,
        env,
        disabled: None,
        server_type: server_type.or_else(|| if url.is_some() { Some("http".to_string()) } else { None }),
        url,
        headers,
    };

    let entry_value = serde_json::to_value(&new_entry)
        .map_err(|e| format!("Failed to serialize entry: {e}"))?;

    let obj = doc.as_object_mut().ok_or("Config is not an object")?;
    let servers = obj.entry("mcpServers")
        .or_insert_with(|| serde_json::json!({}));
    servers.as_object_mut()
        .ok_or("mcpServers is not an object")?
        .insert(name.to_string(), entry_value);

    let json = serde_json::to_string_pretty(&doc)
        .map_err(|e| format!("Failed to serialize: {e}"))?;
    atomic_write_string(Path::new(&config_path), &format!("{json}\n"))?;
    Ok(())
}

// === Git Setup Wizard Commands ===

#[derive(Debug, Serialize, Clone)]
pub struct GitSetupStatus {
    pub git_installed: bool,
    pub git_user_name: Option<String>,
    pub git_user_email: Option<String>,
    pub gh_installed: bool,
    pub gh_authenticated: bool,
    pub gh_username: Option<String>,
    pub ssh_key_exists: bool,
    pub credential_helper_configured: bool,
}

#[tauri::command]
pub async fn check_git_setup() -> Result<GitSetupStatus, String> {
    let env = shell_env();
    let git_installed = which::which("git").is_ok();

    let run_cmd = |prog: &str, args: &[&str]| -> Option<String> {
        std::process::Command::new(prog)
            .args(args)
            .envs(&env)
            .output()
            .ok()
            .and_then(|o| {
                if o.status.success() {
                    let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
                    if s.is_empty() { None } else { Some(s) }
                } else {
                    None
                }
            })
    };

    let git_user_name = if git_installed {
        run_cmd("git", &["config", "--global", "user.name"])
    } else {
        None
    };

    let git_user_email = if git_installed {
        run_cmd("git", &["config", "--global", "user.email"])
    } else {
        None
    };

    let gh_path = resolve_gh_path().ok();
    let gh_installed = gh_path.is_some();

    let gh_authenticated = if let Some(ref gh) = gh_path {
        std::process::Command::new(gh)
            .args(["auth", "status"])
            .envs(&env)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    } else {
        false
    };

    let gh_username = if let Some(ref gh) = gh_path {
        if gh_authenticated {
            run_cmd(gh, &["api", "user", "--jq", ".login"])
        } else {
            None
        }
    } else {
        None
    };

    // Check if any credential helper is configured for github.com.
    // Query without --global so system-level helpers (e.g. osxkeychain) count too.
    let credential_helper_configured = {
        let env2 = env.clone();
        let has_helper = std::process::Command::new("git")
            .args(["config", "credential.helper"])
            .envs(&env2)
            .output()
            .map(|o| o.status.success() && !String::from_utf8_lossy(&o.stdout).trim().is_empty())
            .unwrap_or(false);
        let has_scoped = std::process::Command::new("git")
            .args(["config", "credential.https://github.com.helper"])
            .envs(&env2)
            .output()
            .map(|o| o.status.success() && !String::from_utf8_lossy(&o.stdout).trim().is_empty())
            .unwrap_or(false);
        has_helper || has_scoped
    };

    let home = std::env::var("HOME").unwrap_or_default();
    let ssh_key_exists = std::path::Path::new(&format!("{home}/.ssh/id_ed25519.pub")).exists()
        || std::path::Path::new(&format!("{home}/.ssh/id_rsa.pub")).exists();

    Ok(GitSetupStatus {
        git_installed,
        git_user_name,
        git_user_email,
        gh_installed,
        gh_authenticated,
        gh_username,
        ssh_key_exists,
        credential_helper_configured,
    })
}

#[tauri::command]
pub async fn set_git_config(name: String, email: String) -> Result<(), String> {
    if name.contains('\n') || name.contains('\r') || name.contains('\0') {
        return Err("Invalid name: contains prohibited characters".to_string());
    }
    if email.contains('\n') || email.contains('\r') || email.contains('\0') {
        return Err("Invalid email: contains prohibited characters".to_string());
    }

    let env = shell_env();
    let output = std::process::Command::new("git")
        .args(["config", "--global", "user.name", &name])
        .envs(&env)
        .output()
        .map_err(|e| format!("Failed to set git user.name: {e}"))?;
    if !output.status.success() {
        return Err(format!("Failed to set git user.name: {}", String::from_utf8_lossy(&output.stderr)));
    }

    let output = std::process::Command::new("git")
        .args(["config", "--global", "user.email", &email])
        .envs(&env)
        .output()
        .map_err(|e| format!("Failed to set git user.email: {e}"))?;
    if !output.status.success() {
        return Err(format!("Failed to set git user.email: {}", String::from_utf8_lossy(&output.stderr)));
    }

    Ok(())
}

#[tauri::command]
pub async fn run_gh_auth_login() -> Result<String, String> {
    let gh_path = resolve_gh_path()?;
    let env = shell_env();

    // `gh auth login --web` opens the system browser and completes OAuth without
    // needing a TTY. Pipe stdin from /dev/null so gh doesn't try to prompt.
    // Use shell_env() so gh can find the browser and write its config files.
    let output = std::process::Command::new(&gh_path)
        .args(["auth", "login", "--web", "-p", "https"])
        .envs(&env)
        .env("GH_NO_UPDATE_NOTIFIER", "1")
        .stdin(std::process::Stdio::null())
        .output()
        .map_err(|e| format!("Failed to run gh auth login: {e}"))?;

    if output.status.success() {
        // Require setup-git to succeed so we don't report a false-success state.
        let setup = std::process::Command::new(&gh_path)
            .args(["auth", "setup-git"])
            .envs(&env)
            .output()
            .map_err(|e| format!("Failed to run gh auth setup-git: {e}"))?;
        if !setup.status.success() {
            let stderr = String::from_utf8_lossy(&setup.stderr).trim().to_string();
            return Err(format!("GitHub login succeeded, but git credential setup failed: {stderr}"));
        }
        Ok("Authentication successful".to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        // If gh can't open browser (CI/headless), tell user to run manually
        if stderr.contains("open") || stderr.contains("browser") || stdout.contains("open") {
            Err(format!(
                "Could not open browser automatically. Run this in a terminal:\n  {} auth login\n\nThen restart the app.",
                gh_path
            ))
        } else {
            Err(format!("GitHub auth failed: {}", if stderr.is_empty() { stdout } else { stderr }))
        }
    }
}

#[tauri::command]
pub async fn get_gh_install_instructions() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        Ok("brew install gh".to_string())
    }
    #[cfg(target_os = "linux")]
    {
        Ok("sudo apt install gh  # Debian/Ubuntu\nsudo dnf install gh  # Fedora\n# See https://github.com/cli/cli/blob/trunk/docs/install_linux.md".to_string())
    }
    #[cfg(target_os = "windows")]
    {
        Ok("winget install --id GitHub.cli".to_string())
    }
}

#[tauri::command]
pub async fn run_gh_setup_git() -> Result<(), String> {
    let gh_path = resolve_gh_path()?;
    let env = shell_env();
    let output = std::process::Command::new(&gh_path)
        .args(["auth", "setup-git"])
        .envs(&env)
        .output()
        .map_err(|e| format!("Failed to run gh auth setup-git: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("gh auth setup-git failed: {stderr}"));
    }
    Ok(())
}

#[derive(Debug, Serialize, Clone)]
pub struct DeviceFlowStart {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub interval: u64,
    pub expires_in: u64,
}

#[tauri::command]
pub async fn start_github_device_flow() -> Result<DeviceFlowStart, String> {
    // Hardcoded server-side to prevent frontend substitution with a malicious OAuth app
    let client_id = "Ov23li0vGUgzi9YIZF3U";
    let body_arg = format!("client_id={}&scope=repo", client_id);
    let output = std::process::Command::new("curl")
        .args(["-s", "-X", "POST",
            "https://github.com/login/device/code",
            "-H", "Accept: application/json",
            "-H", "Content-Type: application/x-www-form-urlencoded",
            "-d", &body_arg,
        ])
        .output()
        .map_err(|e| format!("Failed to contact GitHub: {e}"))?;
    let body = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value = serde_json::from_str(&body)
        .map_err(|_| format!("Invalid response from GitHub: {body}"))?;
    if let Some(err) = json.get("error").and_then(|v| v.as_str()) {
        let desc = json.get("error_description").and_then(|v| v.as_str()).unwrap_or(err);
        return Err(format!("GitHub error: {desc}"));
    }
    Ok(DeviceFlowStart {
        device_code: json["device_code"].as_str().unwrap_or("").to_string(),
        user_code: json["user_code"].as_str().unwrap_or("").to_string(),
        verification_uri: json["verification_uri"].as_str().unwrap_or("https://github.com/login/device").to_string(),
        interval: json["interval"].as_u64().unwrap_or(5),
        expires_in: json["expires_in"].as_u64().unwrap_or(900),
    })
}

#[derive(Debug, Serialize, Clone)]
pub struct TokenPollResult {
    pub token: Option<String>,
    pub pending: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn poll_github_token(device_code: String) -> Result<TokenPollResult, String> {
    let client_id = "Ov23li0vGUgzi9YIZF3U";
    if !device_code.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-') {
        return Err("Invalid device_code".to_string());
    }
    let body_arg = format!(
        "client_id={}&device_code={}&grant_type=urn:ietf:params:oauth:grant-type:device_code",
        client_id, device_code
    );
    let output = std::process::Command::new("curl")
        .args(["-s", "-X", "POST",
            "https://github.com/login/oauth/access_token",
            "-H", "Accept: application/json",
            "-H", "Content-Type: application/x-www-form-urlencoded",
            "-d", &body_arg,
        ])
        .output()
        .map_err(|e| format!("Poll failed: {e}"))?;
    let body = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => {
            return Ok(TokenPollResult {
                token: None,
                pending: false,
                error: Some("Invalid response while polling GitHub token".to_string()),
            });
        }
    };
    if let Some(token) = json.get("access_token").and_then(|v| v.as_str()) {
        if !token.is_empty() {
            return Ok(TokenPollResult { token: Some(token.to_string()), pending: false, error: None });
        }
    }
    let err = json.get("error").and_then(|v| v.as_str()).unwrap_or("");
    match err {
        "authorization_pending" | "slow_down" => Ok(TokenPollResult { token: None, pending: true, error: None }),
        "expired_token" => Ok(TokenPollResult { token: None, pending: false, error: Some("Code expired. Please start again.".to_string()) }),
        "access_denied" => Ok(TokenPollResult { token: None, pending: false, error: Some("Access denied by user.".to_string()) }),
        _ => {
            let desc = json.get("error_description").and_then(|v| v.as_str()).unwrap_or("Unknown token polling error");
            Ok(TokenPollResult {
                token: None,
                pending: false,
                error: Some(desc.to_string()),
            })
        }
    }
}

#[tauri::command]
pub async fn save_github_token(token: String) -> Result<(), String> {
    // Validate: GitHub tokens are alphanumeric with underscores/hyphens
    if token.is_empty() || token.len() > 256 {
        return Err("Invalid token".to_string());
    }
    if !token.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-') {
        return Err("Invalid token format".to_string());
    }
    let env = shell_env();

    // For security, do not allow plaintext helper mode. Use --get-urlmatch so we
    // catch the effective helper for the GitHub URL — including a URL-scoped
    // `credential.https://github.com.helper=store`, not just the global helper.
    let helper_output = std::process::Command::new("git")
        .args(["config", "--get-urlmatch", "credential.helper", "https://github.com"])
        .envs(&env)
        .output()
        .map_err(|e| format!("Failed to check credential helper: {e}"))?;
    let helper_text = String::from_utf8_lossy(&helper_output.stdout).to_lowercase();
    if helper_text.lines().any(|h| h.trim() == "store" || h.contains("credential-store")) {
        return Err("Insecure credential.helper=store detected. Please switch to your OS keychain helper or run `gh auth login`.".to_string());
    }

    // Store token through git's credential helper protocol instead of writing plaintext files.
    let mut child = std::process::Command::new("git")
        .args(["credential", "approve"])
        .envs(&env)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to run git credential approve: {e}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        use std::io::Write;
        let payload = format!(
            "protocol=https\nhost=github.com\nusername=oauth2\npassword={token}\n\n"
        );
        stdin
            .write_all(payload.as_bytes())
            .map_err(|e| format!("Failed to write credential payload: {e}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed to finalize credential save: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("Could not store credential via configured helper: {stderr}"));
    }

    Ok(())
}

// === Code Viewer ===

/// Binary-looking file extensions that should not be read as text.
const BINARY_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "bmp", "ico", "webp", "avif", "tiff", "tif",
    "mp3", "mp4", "wav", "ogg", "webm", "avi", "mov", "flac", "aac",
    "zip", "tar", "gz", "bz2", "xz", "7z", "rar", "zst",
    "exe", "dll", "so", "dylib", "a", "o", "obj", "class",
    "woff", "woff2", "ttf", "otf", "eot",
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
    "sqlite", "db", "sqlite3",
    "wasm",
];

/// Maximum file size we will read (10 MB).
const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024;

#[tauri::command]
pub async fn read_file_contents(file_path: String) -> Result<String, String> {
    if file_path.contains("..") || file_path.contains('\0') {
        return Err("Path traversal not allowed".to_string());
    }

    // Canonicalize to resolve symlinks BEFORE checking the boundary constraint.
    // This prevents symlink-based escapes (e.g. ~/evil_link -> /etc/shadow).
    let canonical = std::path::Path::new(&file_path).canonicalize()
        .map_err(|e| format!("Invalid path: {e}"))?;
    let canonical_str = canonical.to_str()
        .ok_or_else(|| "Path contains invalid characters".to_string())?;

    if !is_path_within_allowed_roots(&canonical) {
        return Err("File must be under home directory or /tmp".to_string());
    }

    // Reject known binary extensions
    let lower = canonical_str.to_lowercase();
    if let Some(ext) = lower.rsplit('.').next() {
        if BINARY_EXTENSIONS.contains(&ext) {
            return Err(format!("Binary file type (.{ext}) cannot be displayed as text"));
        }
    }

    // Check file size before reading
    let metadata = std::fs::metadata(canonical_str)
        .map_err(|e| format!("Failed to stat file: {e}"))?;
    if metadata.len() > MAX_FILE_SIZE {
        return Err(format!(
            "File too large ({:.1} MB). Maximum is {} MB.",
            metadata.len() as f64 / (1024.0 * 1024.0),
            MAX_FILE_SIZE / (1024 * 1024)
        ));
    }
    if metadata.len() == 0 {
        return Ok(String::new());
    }

    // Read the file; if it contains invalid UTF-8, report it as binary
    let bytes = std::fs::read(canonical_str)
        .map_err(|e| format!("Failed to read file: {e}"))?;
    String::from_utf8(bytes)
        .map_err(|_| "Binary file: contents are not valid UTF-8 text".to_string())
}

#[tauri::command]
pub async fn write_file_contents(file_path: String, content: String) -> Result<(), String> {
    if file_path.contains("..") || file_path.contains('\0') {
        return Err("Path traversal not allowed".to_string());
    }

    let target = Path::new(&file_path);

    // Canonicalize to resolve symlinks before checking allowed roots.
    // For new files, canonicalize the parent and append the filename.
    let canonical = if target.exists() {
        target.canonicalize()
            .map_err(|e| format!("Failed to resolve path: {e}"))?
    } else {
        let parent = target.parent()
            .ok_or_else(|| "Invalid file path".to_string())?;
        let canon_parent = parent.canonicalize()
            .map_err(|e| format!("Failed to resolve parent directory: {e}"))?;
        canon_parent.join(
            target.file_name().ok_or_else(|| "Invalid file name".to_string())?
        )
    };

    if !is_path_within_allowed_roots(&canonical) {
        return Err("File must be under home directory or /tmp".to_string());
    }

    // Atomic write: write to a temp file then rename to prevent corruption on crash
    let tmp_path = canonical.with_extension(format!(
        "tmp.{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    std::fs::write(&tmp_path, content.as_bytes())
        .map_err(|e| {
            let _ = std::fs::remove_file(&tmp_path);
            format!("Failed to write temp file: {e}")
        })?;
    std::fs::rename(&tmp_path, &canonical)
        .map_err(|e| {
            let _ = std::fs::remove_file(&tmp_path);
            format!("Failed to rename temp file: {e}")
        })?;
    Ok(())
}

#[tauri::command]
pub async fn get_env_allow_status(working_dir: String) -> Result<bool, String> {
    let dir = validate_dir(&working_dir)?;
    let settings_path = PathBuf::from(&dir).join(".claude").join("settings.local.json");
    if !settings_path.exists() {
        return Ok(false);
    }
    let content = std::fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
    let json: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    let allowed = json.get("permissions")
        .and_then(|p| p.get("allow"))
        .and_then(|a| a.as_array())
        .map(|arr| arr.iter().any(|v| v.as_str() == Some("Edit:.env")))
        .unwrap_or(false);
    Ok(allowed)
}

#[tauri::command]
pub async fn toggle_env_allow(working_dir: String, enabled: bool) -> Result<(), String> {
    let dir = validate_dir(&working_dir)?;
    let claude_dir = PathBuf::from(&dir).join(".claude");
    let settings_path = claude_dir.join("settings.local.json");

    let mut json: serde_json::Value = if settings_path.exists() {
        let content = std::fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())?
    } else {
        serde_json::json!({})
    };

    let permissions = json.as_object_mut().ok_or("Invalid JSON")?
        .entry("permissions").or_insert(serde_json::json!({}));
    let allow = permissions.as_object_mut().ok_or("Invalid permissions")?
        .entry("allow").or_insert(serde_json::json!([]));
    let arr = allow.as_array_mut().ok_or("Invalid allow array")?;

    let entry = serde_json::Value::String("Edit:.env".to_string());
    if enabled {
        if !arr.contains(&entry) {
            arr.push(entry);
        }
    } else {
        arr.retain(|v| v != &entry);
    }

    std::fs::create_dir_all(&claude_dir).map_err(|e| e.to_string())?;
    let content = serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?;
    std::fs::write(&settings_path, content).map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// File operations
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn rename_file(old_path: String, new_name: String) -> Result<String, String> {
    if old_path.contains('\0') || new_name.contains('\0') || new_name.contains('/') || new_name.contains('\\') {
        return Err("Invalid characters in path or name".to_string());
    }
    if new_name.trim().is_empty() || new_name == "." || new_name == ".." {
        return Err("Invalid file name".to_string());
    }
    let source = Path::new(&old_path);
    if !source.exists() {
        return Err("Source file does not exist".to_string());
    }
    if !is_path_within_allowed_roots(source) {
        return Err("File must be under home directory or /tmp".to_string());
    }
    let parent = source.parent().ok_or("Cannot determine parent directory")?;
    let dest = parent.join(new_name.trim());
    if dest.exists() {
        return Err("A file with that name already exists".to_string());
    }
    std::fs::rename(source, &dest).map_err(|e| format!("Rename failed: {e}"))?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn delete_file(file_path: String) -> Result<(), String> {
    if file_path.contains('\0') {
        return Err("Invalid path".to_string());
    }
    let target = Path::new(&file_path);
    if !target.exists() {
        return Err("File does not exist".to_string());
    }
    if !is_path_within_allowed_roots(target) {
        return Err("File must be under home directory or /tmp".to_string());
    }
    if target.is_dir() {
        std::fs::remove_dir_all(target).map_err(|e| format!("Delete failed: {e}"))?;
    } else {
        std::fs::remove_file(target).map_err(|e| format!("Delete failed: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn move_file(source_path: String, dest_dir: String) -> Result<String, String> {
    if source_path.contains('\0') || dest_dir.contains('\0') {
        return Err("Invalid path".to_string());
    }
    let source = Path::new(&source_path);
    let dest_parent = Path::new(&dest_dir);
    if !source.exists() {
        return Err("Source does not exist".to_string());
    }
    if !dest_parent.is_dir() {
        return Err("Destination is not a directory".to_string());
    }
    if !is_path_within_allowed_roots(source) || !is_path_within_allowed_roots(dest_parent) {
        return Err("Paths must be under home directory or /tmp".to_string());
    }
    let file_name = source.file_name().ok_or("Cannot determine file name")?;
    let dest = dest_parent.join(file_name);
    if dest.exists() {
        return Err("A file with that name already exists at the destination".to_string());
    }
    std::fs::rename(source, &dest).map_err(|e| format!("Move failed: {e}"))?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn copy_file(source_path: String, dest_dir: String) -> Result<String, String> {
    if source_path.contains('\0') || dest_dir.contains('\0') {
        return Err("Invalid path".to_string());
    }
    let source = Path::new(&source_path);
    let dest_parent = Path::new(&dest_dir);
    if !source.exists() {
        return Err("Source does not exist".to_string());
    }
    if !dest_parent.is_dir() {
        return Err("Destination is not a directory".to_string());
    }
    if !is_path_within_allowed_roots(source) || !is_path_within_allowed_roots(dest_parent) {
        return Err("Paths must be under home directory or /tmp".to_string());
    }
    let file_name = source.file_name().ok_or("Cannot determine file name")?;
    let dest = dest_parent.join(file_name);
    if dest.exists() {
        return Err("A file with that name already exists at the destination".to_string());
    }
    if source.is_dir() {
        copy_dir_recursive(source, &dest)?;
    } else {
        std::fs::copy(source, &dest).map_err(|e| format!("Copy failed: {e}"))?;
    }
    Ok(dest.to_string_lossy().to_string())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| format!("Failed to create directory: {e}"))?;
    for entry in std::fs::read_dir(src).map_err(|e| format!("Failed to read directory: {e}"))? {
        let entry = entry.map_err(|e| format!("Failed to read entry: {e}"))?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path).map_err(|e| format!("Failed to copy file: {e}"))?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Project-wide search
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Clone)]
pub struct SearchResult {
    pub file_path: String,
    pub line_number: u32,
    pub line_content: String,
    pub match_start: u32,
    pub match_end: u32,
}

#[tauri::command]
pub async fn search_files(
    working_dir: String,
    query: String,
    case_sensitive: Option<bool>,
    use_regex: Option<bool>,
    max_results: Option<u32>,
) -> Result<Vec<SearchResult>, String> {
    use walkdir::WalkDir;

    let dir = validate_dir(&working_dir)?;
    let case_sensitive = case_sensitive.unwrap_or(false);
    let _use_regex = use_regex.unwrap_or(false);
    let max = max_results.unwrap_or(500) as usize;
    let gitignore_patterns = collect_gitignore_patterns(&dir);

    if query.is_empty() {
        return Ok(Vec::new());
    }

    let query_lower = if case_sensitive { query.clone() } else { query.to_lowercase() };

    // Binary file extensions to skip
    let binary_exts: std::collections::HashSet<&str> = [
        "png", "jpg", "jpeg", "gif", "bmp", "ico", "webp", "svg",
        "woff", "woff2", "ttf", "otf", "eot",
        "zip", "tar", "gz", "bz2", "xz", "7z", "rar",
        "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
        "exe", "dll", "so", "dylib", "o", "a",
        "mp3", "mp4", "avi", "mov", "wav", "flac", "ogg",
        "sqlite", "db", "wasm",
    ].iter().copied().collect();

    let skip_dirs: std::collections::HashSet<&str> = [
        "node_modules", ".git", "target", "dist", "build", ".next",
        "__pycache__", ".venv", "venv", ".tox", "vendor",
        ".DS_Store", ".worktrees",
    ].iter().copied().collect();

    let mut results = Vec::new();

    for entry in WalkDir::new(&dir)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            if e.file_type().is_dir() {
                return !skip_dirs.contains(name.as_ref());
            }
            true
        })
    {
        if results.len() >= max {
            break;
        }
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();

        // Skip binary extensions
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            if binary_exts.contains(ext.to_lowercase().as_str()) {
                continue;
            }
        }

        // Skip gitignored files
        if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
            if matches_gitignore(file_name, &gitignore_patterns) {
                continue;
            }
        }

        // Read file
        let content = match std::fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => continue, // skip binary or unreadable files
        };

        for (line_idx, line) in content.lines().enumerate() {
            if results.len() >= max {
                break;
            }
            let (found, start, end) = if case_sensitive {
                match line.find(&query) {
                    Some(pos) => (true, pos, pos + query.len()),
                    None => (false, 0, 0),
                }
            } else {
                match line.to_lowercase().find(&query_lower) {
                    Some(pos) => (true, pos, pos + query.len()),
                    None => (false, 0, 0),
                }
            };
            if found {
                results.push(SearchResult {
                    file_path: path.to_string_lossy().to_string(),
                    line_number: (line_idx + 1) as u32,
                    line_content: if line.len() > 500 { line[..500].to_string() } else { line.to_string() },
                    match_start: start as u32,
                    match_end: end as u32,
                });
            }
        }
    }

    Ok(results)
}

// ---------------------------------------------------------------------------
// Git hunk staging
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn git_stage_hunk(working_dir: String, file_path: String, hunk_header: String) -> Result<(), String> {
    let dir = validate_dir(&working_dir)?;
    validate_file_path(&file_path)?;

    // Get the full diff for this file
    let diff_output = std::process::Command::new("git")
        .args(["diff", &file_path])
        .current_dir(&dir)
        .output()
        .map_err(|e| format!("Failed to run git diff: {e}"))?;

    let full_diff = String::from_utf8_lossy(&diff_output.stdout).to_string();

    // Extract the file header and the target hunk
    let mut patch = String::new();
    let mut in_target_hunk = false;
    let mut found_file_header = false;

    for line in full_diff.lines() {
        if line.starts_with("diff --git") {
            if found_file_header && in_target_hunk {
                break; // We've collected our hunk, stop
            }
            patch.push_str(line);
            patch.push('\n');
            found_file_header = true;
            in_target_hunk = false;
            continue;
        }
        if !found_file_header {
            continue;
        }
        // Collect file-level headers (---, +++, index)
        if line.starts_with("---") || line.starts_with("+++") || line.starts_with("index ") {
            if !in_target_hunk {
                patch.push_str(line);
                patch.push('\n');
            }
            continue;
        }
        if line.starts_with("@@") {
            in_target_hunk = line.contains(&hunk_header) || line == hunk_header;
            if in_target_hunk {
                patch.push_str(line);
                patch.push('\n');
            }
            continue;
        }
        if in_target_hunk {
            // Lines belonging to the target hunk
            if line.starts_with('+') || line.starts_with('-') || line.starts_with(' ') || line == "\\ No newline at end of file" {
                patch.push_str(line);
                patch.push('\n');
            }
        }
    }

    if patch.is_empty() || !in_target_hunk {
        return Err("Could not find the specified hunk in the diff".to_string());
    }

    // Apply the patch to the index
    let mut child = std::process::Command::new("git")
        .args(["apply", "--cached", "--unidiff-zero", "-"])
        .current_dir(&dir)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start git apply: {e}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        use std::io::Write;
        stdin.write_all(patch.as_bytes()).map_err(|e| format!("Failed to write patch: {e}"))?;
    }

    let output = child.wait_with_output().map_err(|e| format!("Failed to wait for git apply: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to stage hunk: {stderr}"));
    }

    Ok(())
}

// === Dependency Graph Analysis ===

#[derive(Serialize, Clone)]
pub struct DepNode {
    pub path: String,
    pub name: String,
}

#[derive(Serialize, Clone)]
pub struct DepEdge {
    pub from: String,
    pub to: String,
}

#[derive(Serialize)]
pub struct DepGraph {
    pub nodes: Vec<DepNode>,
    pub edges: Vec<DepEdge>,
}

#[tauri::command]
pub async fn analyze_dependencies(working_dir: String) -> Result<DepGraph, String> {
    let validated = validate_dir(&working_dir)?;
    let dir = std::path::Path::new(&validated);
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    let mut file_paths: Vec<String> = Vec::new();

    fn walk(dir: &std::path::Path, files: &mut Vec<String>, depth: usize) {
        if depth > 20 { return; }
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let ft = entry.file_type();
            if ft.is_err() || ft.as_ref().unwrap().is_symlink() { continue; }
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name == "node_modules" || name == "target" || name == "dist" || name == "build" {
                continue;
            }
            if path.is_dir() {
                walk(&path, files, depth + 1);
            } else {
                let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                if matches!(ext, "ts" | "tsx" | "js" | "jsx" | "py" | "rs") {
                    if let Some(s) = path.to_str() {
                        files.push(s.to_string());
                    }
                }
            }
        }
    }

    walk(dir, &mut file_paths, 0);

    let root = working_dir.clone();
    for file_path in &file_paths {
        let relative = file_path.strip_prefix(&root).unwrap_or(file_path).trim_start_matches('/');
        let name = relative.rsplit('/').next().unwrap_or(relative);
        nodes.push(DepNode { path: relative.to_string(), name: name.to_string() });
    }

    use std::sync::LazyLock;
    static IMPORT_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(r#"(?:import\s+.*?from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\)|from\s+(\S+)\s+import|use\s+(?:crate::)?(\S+?)(?:::\{|;))"#).unwrap()
    });

    let relative_paths: std::collections::HashSet<String> = file_paths.iter()
        .map(|f| f.strip_prefix(&root).unwrap_or(f).trim_start_matches('/').to_string())
        .collect();

    for file_path in &file_paths {
        let Ok(content) = std::fs::read_to_string(file_path) else { continue };
        let relative_from = file_path.strip_prefix(&root).unwrap_or(file_path).trim_start_matches('/');

        for cap in IMPORT_RE.captures_iter(&content) {
            let import_path = cap.get(1).or(cap.get(2)).or(cap.get(3)).or(cap.get(4));
            if let Some(m) = import_path {
                let raw = m.as_str();
                // JS/TS: relative imports start with '.'
                // Rust: use crate::/self::/super:: (regex strips crate:: prefix, so check for module-like names)
                let is_relative = raw.starts_with('.');
                let is_rust_local = !raw.contains("std::") && !raw.contains("tokio::") && !raw.contains("serde");
                let ext = std::path::Path::new(file_path).extension().and_then(|e| e.to_str()).unwrap_or("");
                let is_rust_file = ext == "rs";
                if is_relative || (is_rust_file && is_rust_local) {
                    let from_dir = std::path::Path::new(file_path).parent().unwrap_or(std::path::Path::new(""));
                    let resolved = from_dir.join(raw.replace("crate::", "src/"));

                    let candidates = [
                        resolved.to_string_lossy().to_string(),
                        format!("{}.ts", resolved.display()),
                        format!("{}.tsx", resolved.display()),
                        format!("{}.js", resolved.display()),
                        format!("{}.rs", resolved.display()),
                        format!("{}.py", resolved.display()),
                        format!("{}/index.ts", resolved.display()),
                        format!("{}/index.tsx", resolved.display()),
                        format!("{}/mod.rs", resolved.display()),
                        format!("{}/__init__.py", resolved.display()),
                    ];

                    for candidate in &candidates {
                        let rel = candidate.strip_prefix(&root).unwrap_or(candidate).trim_start_matches('/');
                        if relative_paths.contains(rel) {
                            edges.push(DepEdge { from: relative_from.to_string(), to: rel.to_string() });
                            break;
                        }
                    }
                }
            }
        }
    }

    Ok(DepGraph { nodes, edges })
}

// === Notes Persistence ===
//
// Notes live as plain `.md` files under
//   $APP_DATA/notes/<workspaceId>/<noteId>.md
// with a sidecar JSON sibling
//   $APP_DATA/notes/<workspaceId>/<noteId>.json
// holding non-content metadata (color, x/y/w/h, pinnedTo, title).
//
// Plain markdown means an agent in any pane can read/edit a note by path —
// `grep`-able, syncable, and AI-friendly without any custom format.

fn notes_dir(workspace_id: &str) -> Result<std::path::PathBuf, String> {
    let base = if let Ok(home) = std::env::var("HOME") {
        std::path::PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("CodeGrid")
            .join("notes")
    } else {
        std::path::PathBuf::from("/tmp/codegrid/notes")
    };
    // Sanitise workspace id — only allow alphanumerics, dashes, and underscores.
    let safe: String = workspace_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    if safe.is_empty() {
        return Err("Invalid workspace id".to_string());
    }
    let dir = base.join(safe);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create notes dir: {e}"))?;
    Ok(dir)
}

fn safe_note_id(id: &str) -> Result<String, String> {
    let safe: String = id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    if safe.is_empty() || safe.len() > 128 {
        return Err("Invalid note id".to_string());
    }
    Ok(safe)
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Default)]
pub struct NoteMeta {
    pub id: String,
    pub workspace_id: String,
    pub title: Option<String>,
    pub color: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub pinned_to: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(serde::Serialize, Clone)]
pub struct NoteRecord {
    #[serde(flatten)]
    pub meta: NoteMeta,
    pub text: String,
}

#[tauri::command]
pub async fn notes_list(workspace_id: String) -> Result<Vec<NoteRecord>, String> {
    let dir = notes_dir(&workspace_id)?;
    let mut out: Vec<NoteRecord> = Vec::new();
    let read = match std::fs::read_dir(&dir) {
        Ok(r) => r,
        Err(_) => return Ok(out),
    };
    for entry in read.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let meta_json = match std::fs::read_to_string(&path) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let meta: NoteMeta = match serde_json::from_str(&meta_json) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let md_path = path.with_extension("md");
        let text = std::fs::read_to_string(&md_path).unwrap_or_default();
        out.push(NoteRecord { meta, text });
    }
    out.sort_by_key(|n| n.meta.created_at);
    Ok(out)
}

#[tauri::command]
pub async fn notes_write(meta: NoteMeta, text: String) -> Result<(), String> {
    let dir = notes_dir(&meta.workspace_id)?;
    let id = safe_note_id(&meta.id)?;
    let meta_path = dir.join(format!("{id}.json"));
    let md_path = dir.join(format!("{id}.md"));
    let meta_json = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    std::fs::write(&meta_path, meta_json).map_err(|e| format!("Failed to write note meta: {e}"))?;
    std::fs::write(&md_path, text).map_err(|e| format!("Failed to write note body: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn notes_delete(workspace_id: String, note_id: String) -> Result<(), String> {
    let dir = notes_dir(&workspace_id)?;
    let id = safe_note_id(&note_id)?;
    let _ = std::fs::remove_file(dir.join(format!("{id}.json")));
    let _ = std::fs::remove_file(dir.join(format!("{id}.md")));
    Ok(())
}

#[derive(serde::Serialize, Clone)]
pub struct SystemMemoryInfo {
    pub total_memory_mb: u64,
    pub available_memory_mb: u64,
    pub used_memory_mb: u64,
    pub usage_percent: f64,
}

#[tauri::command]
pub async fn get_system_memory() -> Result<SystemMemoryInfo, String> {
    use sysinfo::System;
    let mut sys = System::new_all();
    sys.refresh_memory();
    let total = sys.total_memory() / 1_048_576;
    let used = sys.used_memory() / 1_048_576;
    let available = total.saturating_sub(used);
    Ok(SystemMemoryInfo {
        total_memory_mb: total,
        available_memory_mb: available,
        used_memory_mb: used,
        usage_percent: if total > 0 { (used as f64 / total as f64) * 100.0 } else { 0.0 },
    })
}

#[tauri::command]
pub async fn reveal_in_finder(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !is_path_or_parent_within_allowed_roots(p) {
        return Err("Access denied: path must be under your home directory or /tmp".to_string());
    }
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.is_dir() {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    } else {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn open_in_default_app(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !is_path_or_parent_within_allowed_roots(p) {
        return Err("Access denied: path must be under your home directory or /tmp".to_string());
    }
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn clipboard_write(text: String) -> Result<(), String> {
    std::process::Command::new("pbcopy")
        .stdin(std::process::Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            use std::io::Write;
            if let Some(ref mut stdin) = child.stdin {
                stdin.write_all(text.as_bytes())?;
            }
            child.wait()?;
            Ok(())
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

// === Additional Git Commands ===

#[tauri::command]
pub async fn git_init(working_dir: String) -> Result<String, String> {
    let expanded = expand_tilde(&working_dir);
    let path = Path::new(&expanded);
    if !path.is_dir() {
        return Err(format!("Directory does not exist: {expanded}"));
    }
    let canonical = path.canonicalize().map_err(|e| format!("Invalid path: {e}"))?;
    if !is_path_within_allowed_roots(&canonical) {
        return Err("Access denied: path must be under your home directory or /tmp".to_string());
    }
    let dir = canonical.to_str().ok_or("Path contains invalid characters")?.to_string();
    run_git(&dir, &["init"])
}

#[tauri::command]
pub async fn git_delete_branch(working_dir: String, branch_name: String, force: bool) -> Result<String, String> {
    let dir = validate_dir(&working_dir)?;
    validate_branch_name(&branch_name)?;
    let flag = if force { "-D" } else { "-d" };
    run_git(&dir, &["branch", flag, &branch_name])
}

#[tauri::command]
pub async fn git_merge_branch(working_dir: String, branch_name: String) -> Result<String, String> {
    let dir = validate_dir(&working_dir)?;
    validate_branch_name(&branch_name)?;
    run_git(&dir, &["merge", &branch_name])
}

#[tauri::command]
pub async fn git_amend_commit(working_dir: String, message: Option<String>) -> Result<String, String> {
    let dir = validate_dir(&working_dir)?;
    match message {
        Some(msg) => run_git(&dir, &["commit", "--amend", "-m", &msg]),
        None => run_git(&dir, &["commit", "--amend", "--no-edit"]),
    }
}

#[tauri::command]
pub async fn git_discard_all(working_dir: String) -> Result<String, String> {
    let dir = validate_dir(&working_dir)?;
    run_git(&dir, &["checkout", "--", "."])?;
    run_git(&dir, &["clean", "-fd"])?;
    Ok("All working changes discarded".to_string())
}

#[tauri::command]
pub async fn git_blame_file(working_dir: String, file_path: String) -> Result<Vec<GitBlameEntry>, String> {
    let dir = validate_dir(&working_dir)?;
    validate_file_path(&file_path)?;
    let output = run_git(&dir, &["blame", "--porcelain", &file_path])?;

    let mut entries: Vec<GitBlameEntry> = Vec::new();
    let mut current_hash = String::new();
    let mut current_author = String::new();
    let mut current_date = String::new();
    let mut current_line_number: u32 = 0;

    for line in output.lines() {
        if line.len() >= 40 && line.chars().take(40).all(|c| c.is_ascii_hexdigit()) {
            let parts: Vec<&str> = line.split_whitespace().collect();
            current_hash = parts[0].to_string();
            if let Some(ln) = parts.get(2) {
                current_line_number = ln.parse().unwrap_or(0);
            }
        } else if let Some(author) = line.strip_prefix("author ") {
            current_author = author.to_string();
        } else if let Some(time) = line.strip_prefix("author-time ") {
            current_date = time.to_string();
        } else if let Some(content) = line.strip_prefix('\t') {
            entries.push(GitBlameEntry {
                hash: current_hash.clone(),
                author: current_author.clone(),
                date: current_date.clone(),
                line_number: current_line_number,
                content: content.to_string(),
            });
        }
    }

    Ok(entries)
}

#[tauri::command]
pub async fn git_tag(working_dir: String, tag_name: String, message: Option<String>) -> Result<String, String> {
    let dir = validate_dir(&working_dir)?;
    validate_branch_name(&tag_name)?;
    match message {
        Some(msg) => run_git(&dir, &["tag", "-a", &tag_name, "-m", &msg]),
        None => run_git(&dir, &["tag", &tag_name]),
    }
}

#[tauri::command]
pub async fn git_list_tags(working_dir: String) -> Result<Vec<String>, String> {
    let dir = validate_dir(&working_dir)?;
    let output = run_git(&dir, &["tag", "-l", "--sort=-creatordate"])?;
    Ok(output.lines().filter(|l| !l.is_empty()).map(|l| l.to_string()).collect())
}

#[tauri::command]
pub async fn git_cherry_pick(working_dir: String, commit_hash: String) -> Result<String, String> {
    let dir = validate_dir(&working_dir)?;
    validate_commit_hash(&commit_hash)?;
    run_git(&dir, &["cherry-pick", &commit_hash])
}

#[tauri::command]
pub async fn git_revert_commit(working_dir: String, commit_hash: String) -> Result<String, String> {
    let dir = validate_dir(&working_dir)?;
    validate_commit_hash(&commit_hash)?;
    run_git(&dir, &["revert", "--no-edit", &commit_hash])
}

#[tauri::command]
pub async fn git_stash_list(working_dir: String) -> Result<Vec<GitStashEntry>, String> {
    let dir = validate_dir(&working_dir)?;
    let output = run_git(&dir, &["stash", "list", "--format=%gd|||%gs"]).unwrap_or_default();
    let entries = output
        .lines()
        .filter(|l| !l.is_empty())
        .enumerate()
        .map(|(i, line)| {
            let parts: Vec<&str> = line.splitn(2, "|||").collect();
            GitStashEntry {
                index: i as u32,
                message: parts.get(1).unwrap_or(&"").to_string(),
            }
        })
        .collect();
    Ok(entries)
}

#[tauri::command]
pub async fn git_stash_drop(working_dir: String, index: u32) -> Result<String, String> {
    let dir = validate_dir(&working_dir)?;
    let stash_ref = format!("stash@{{{index}}}");
    run_git(&dir, &["stash", "drop", &stash_ref])
}

// === Git: additional safe operations ===

/// Unstage everything (keep working-tree changes).
#[tauri::command]
pub async fn git_unstage_all(working_dir: String) -> Result<String, String> {
    let dir = validate_dir(&working_dir)?;
    run_git(&dir, &["reset", "-q", "HEAD", "--"])
}

/// Apply a stash without removing it from the stash list.
#[tauri::command]
pub async fn git_stash_apply(working_dir: String, index: u32) -> Result<String, String> {
    let dir = validate_dir(&working_dir)?;
    let stash_ref = format!("stash@{{{index}}}");
    run_git(&dir, &["stash", "apply", &stash_ref])
}

/// Delete a tag.
#[tauri::command]
pub async fn git_tag_delete(working_dir: String, tag_name: String) -> Result<String, String> {
    let dir = validate_dir(&working_dir)?;
    validate_branch_name(&tag_name)?; // same ref-name safety rules
    run_git(&dir, &["tag", "-d", &tag_name])
}

/// Rename a branch (`git branch -m <old> <new>`).
#[tauri::command]
pub async fn git_rename_branch(working_dir: String, old_name: String, new_name: String) -> Result<String, String> {
    let dir = validate_dir(&working_dir)?;
    validate_branch_name(&old_name)?;
    validate_branch_name(&new_name)?;
    run_git(&dir, &["branch", "-m", &old_name, &new_name])
}

#[derive(Debug, Serialize, Clone)]
pub struct GitRemote {
    pub name: String,
    pub url: String,
}

/// List configured remotes (deduped name + fetch URL).
#[tauri::command]
pub async fn git_list_remotes(working_dir: String) -> Result<Vec<GitRemote>, String> {
    let dir = validate_dir(&working_dir)?;
    let output = run_git(&dir, &["remote", "-v"]).unwrap_or_default();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut remotes = Vec::new();
    for line in output.lines() {
        // Format: "origin\thttps://...\t(fetch)"
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 && seen.insert(parts[0].to_string()) {
            remotes.push(GitRemote { name: parts[0].to_string(), url: parts[1].to_string() });
        }
    }
    Ok(remotes)
}

/// Add a remote.
#[tauri::command]
pub async fn git_add_remote(working_dir: String, name: String, url: String) -> Result<String, String> {
    let dir = validate_dir(&working_dir)?;
    validate_branch_name(&name)?; // ref-name safety for the remote name
    if url.starts_with('-') || url.contains(|c: char| " \t\n\r$`|;&<>(){}".contains(c)) {
        return Err("Invalid remote URL".to_string());
    }
    run_git(&dir, &["remote", "add", &name, &url])
}

/// Remove a remote.
#[tauri::command]
pub async fn git_remove_remote(working_dir: String, name: String) -> Result<String, String> {
    let dir = validate_dir(&working_dir)?;
    validate_branch_name(&name)?;
    run_git(&dir, &["remote", "remove", &name])
}

/// Poll the entitlement relay for a desktop-link `state`. Returns the
/// entitlement JWT once the browser sign-in completes, or `None` while pending.
/// Runs from Rust (not the CSP-locked webview), so it isn't subject to CORS —
/// this is how the desktop links hands-free without a `codegrid://` round-trip.
#[tauri::command]
pub async fn poll_entitlement(state: String) -> Result<Option<String>, String> {
    if state.is_empty() || !state.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("invalid state".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || -> Result<Option<String>, String> {
        let url = format!("https://grid-verifier.zippy-host.workers.dev/link/{state}");
        let out = std::process::Command::new("curl")
            .args(["-fsS", "--max-time", "8", &url])
            .output()
            .map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Ok(None); // not ready / transient network — treat as pending
        }
        let body: serde_json::Value =
            serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())?;
        if body.get("pending").and_then(|v| v.as_bool()) == Some(true) {
            return Ok(None);
        }
        Ok(body
            .get("token")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// POST a JSON body to a grid-review assist endpoint with the entitlement bearer.
/// Returns (http_status, response_body). Bearer kept out of argv via a 0600 -K file.
fn assist_post(url: &str, token: &str, body_str: &str) -> Result<(String, String), String> {
    let tmp_dir = std::env::temp_dir();
    let nonce = Uuid::new_v4();
    let req_path = tmp_dir.join(format!("codegrid-assist-req-{nonce}.json"));
    let resp_path = tmp_dir.join(format!("codegrid-assist-resp-{nonce}.json"));
    let cfg_path = tmp_dir.join(format!("codegrid-assist-cfg-{nonce}.txt"));
    std::fs::write(&req_path, body_str.as_bytes()).map_err(|e| format!("write request: {e}"))?;
    std::fs::write(
        &cfg_path,
        format!("header = \"Authorization: Bearer {token}\"\n").as_bytes(),
    )
    .map_err(|e| {
        let _ = std::fs::remove_file(&req_path);
        format!("write auth config: {e}")
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&cfg_path, std::fs::Permissions::from_mode(0o600));
    }
    let req_arg = format!("@{}", req_path.to_string_lossy());
    let resp_str = resp_path.to_string_lossy().to_string();
    let cfg_str = cfg_path.to_string_lossy().to_string();
    let result = std::process::Command::new("curl")
        .args([
            "-sS", "-X", "POST", url, "-K", &cfg_str, "-H", "content-type: application/json",
            "--data-binary", &req_arg, "-o", &resp_str, "-w", "%{http_code}",
        ])
        .output();
    let _ = std::fs::remove_file(&req_path);
    let _ = std::fs::remove_file(&cfg_path);
    let output = result.map_err(|e| {
        let _ = std::fs::remove_file(&resp_path);
        format!("Could not reach the assist service: {e}")
    })?;
    let status = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let body = std::fs::read_to_string(&resp_path).unwrap_or_default();
    let _ = std::fs::remove_file(&resp_path);
    Ok((status, body))
}

fn assist_field(resp: &str, field: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(resp)
        .ok()
        .and_then(|v| v.get(field).and_then(|m| m.as_str()).map(|s| s.to_string()))
}

/// Pro: generate a git commit message from the staged diff with the cheap model.
#[tauri::command]
pub async fn ai_commit_message(
    state: State<'_, Arc<AppState>>,
    working_dir: String,
    conventional: Option<bool>,
) -> Result<String, String> {
    let dir = validate_dir(&working_dir)?;
    let staged = run_git(&dir, &["diff", "--cached"]).unwrap_or_default();
    let diff = if staged.trim().is_empty() {
        run_git(&dir, &["diff"]).unwrap_or_default() // fall back to unstaged so it works pre-add
    } else {
        staged
    };
    if diff.trim().is_empty() {
        return Err("No changes to describe — stage or edit something first.".to_string());
    }
    let token = crate::entitlement::get_entitlement()?
        .ok_or_else(|| "Link your wallet (Settings → Premium) to use AI commit names.".to_string())?;
    let url = format!("{}/commit-message", review_base_url(&state));
    let body = serde_json::json!({
        "diff": diff,
        "format": if conventional.unwrap_or(false) { "conventional" } else { "plain" },
    });
    let body_str = serde_json::to_string(&body).map_err(|e| format!("encode: {e}"))?;
    let (status, resp) = assist_post(&url, &token, &body_str)?;
    match status.as_str() {
        "200" => assist_field(&resp, "message")
            .ok_or_else(|| "The assist service returned an unreadable response.".to_string()),
        "429" => Err("You've hit your monthly AI-assist limit — it resets on the 1st.".to_string()),
        "401" => Err("Your entitlement could not be verified. Re-link your wallet in Settings → Premium.".to_string()),
        "403" => Err("AI commit names require an active Pro stake.".to_string()),
        _ => Err("The assist service is unavailable. Try again later.".to_string()),
    }
}

/// Pro: name a terminal from recent output (cheap model). The frontend passes the
/// exact text to summarize, so the user controls what leaves the machine.
#[tauri::command]
pub async fn summarize_terminal(
    state: State<'_, Arc<AppState>>,
    text: String,
) -> Result<String, String> {
    if text.trim().is_empty() {
        return Err("Nothing to summarize yet.".to_string());
    }
    let token = crate::entitlement::get_entitlement()?
        .ok_or_else(|| "Link your wallet (Settings → Premium) to use AI naming.".to_string())?;
    let url = format!("{}/summarize", review_base_url(&state));
    let body = serde_json::json!({ "text": text });
    let body_str = serde_json::to_string(&body).map_err(|e| format!("encode: {e}"))?;
    let (status, resp) = assist_post(&url, &token, &body_str)?;
    match status.as_str() {
        "200" => assist_field(&resp, "name")
            .ok_or_else(|| "The assist service returned an unreadable response.".to_string()),
        "429" => Err("You've hit your monthly AI-assist limit — it resets on the 1st.".to_string()),
        "401" => Err("Re-link your wallet in Settings → Premium.".to_string()),
        "403" => Err("AI naming requires an active Pro stake.".to_string()),
        _ => Err("The assist service is unavailable. Try again later.".to_string()),
    }
}

