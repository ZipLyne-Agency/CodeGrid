import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// Types matching Rust structs
export interface SessionInfo {
  id: string;
  workspace_id: string;
  working_dir: string;
  command: string;
  git_branch: string | null;
  status: "idle" | "running" | "waiting" | "error" | "dead";
  created_at: string;
  pane_number: number;
  worktree_path: string | null;
  /** User-assigned display name, persisted to DB. null = auto-detected. */
  name: string | null;
}

export interface PtyOutput {
  session_id: string;
  data: number[];
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  layout_json: string | null;
  created_at: string;
  is_active: boolean;
  repo_path: string | null;
}

// Session commands
export type AgentType = "claude" | "codex" | "gemini" | "cursor" | "grok" | "venice";

export async function createSession(
  workingDir: string,
  workspaceId: string,
  useWorktree: boolean = false,
  resume: boolean = false,
  sessionType: AgentType | "shell" = "claude",
  continueSession: boolean = false,
): Promise<SessionInfo> {
  return invoke("create_session", {
    workingDir,
    workspaceId,
    useWorktree,
    resume,
    sessionType,
    continueSession,
  });
}

export async function writeToPty(
  sessionId: string,
  data: Uint8Array,
): Promise<void> {
  return invoke("write_to_pty", {
    sessionId,
    data: Array.from(data),
  });
}

export async function connectPty(sessionId: string): Promise<void> {
  return invoke("connect_pty", { sessionId });
}

export async function resizePty(
  sessionId: string,
  cols: number,
  rows: number,
): Promise<void> {
  return invoke("resize_pty", { sessionId, cols, rows });
}

export async function killSession(sessionId: string): Promise<void> {
  return invoke("kill_session", { sessionId });
}

export async function getSessions(
  workspaceId: string,
): Promise<SessionInfo[]> {
  return invoke("get_sessions", { workspaceId });
}

/** Load sessions from the DB (all returned as status=dead). Used to restore layout on startup. */
export async function getPersistedSessions(workspaceId: string): Promise<SessionInfo[]> {
  return invoke("get_persisted_sessions", { workspaceId });
}

/** Delete old persisted sessions from DB after restoring them on startup. */
export async function clearPersistedSessions(workspaceId: string, sessionIds: string[]): Promise<void> {
  return invoke("clear_persisted_sessions", { workspaceId, sessionIds });
}

/** Persist a user-assigned name for a session tab (null to clear). */
export async function renameSession(sessionId: string, name: string | null): Promise<void> {
  return invoke("rename_session", { sessionId, name });
}

export async function updateSessionStatus(
  sessionId: string,
  status: string,
): Promise<void> {
  return invoke("update_session_status", { sessionId, status });
}

// Workspace commands
export async function createWorkspace(name: string): Promise<WorkspaceInfo> {
  return invoke("create_workspace", { name });
}

export async function getWorkspaces(): Promise<WorkspaceInfo[]> {
  return invoke("get_workspaces");
}

export async function deleteWorkspace(workspaceId: string): Promise<void> {
  return invoke("delete_workspace", { workspaceId });
}

export async function setActiveWorkspace(workspaceId: string): Promise<void> {
  return invoke("set_active_workspace", { workspaceId });
}

export async function saveLayout(
  workspaceId: string,
  layoutJson: string,
): Promise<void> {
  return invoke("save_layout", { workspaceId, layoutJson });
}

export async function renameWorkspace(
  workspaceId: string,
  name: string,
): Promise<void> {
  return invoke("rename_workspace", { workspaceId, name });
}

export async function setWorkspaceRepo(
  workspaceId: string,
  repoPath: string | null,
): Promise<void> {
  return invoke("set_workspace_repo", { workspaceId, repoPath });
}

export async function createWorkspaceWithRepo(
  name: string,
  repoPath: string | null,
): Promise<WorkspaceInfo> {
  return invoke("create_workspace_with_repo", { name, repoPath });
}

// CLAUDE.md management
export async function readClaudeMd(projectDir: string): Promise<string | null> {
  return invoke("read_claude_md", { projectDir });
}

export async function writeClaudeMd(projectDir: string, content: string): Promise<void> {
  return invoke("write_claude_md", { projectDir, content });
}

// Additional git commands
export async function gitFetch(workingDir: string): Promise<string> {
  return invoke("git_fetch", { workingDir });
}

export async function gitStash(workingDir: string, pop: boolean = false): Promise<string> {
  return invoke("git_stash", { workingDir, pop });
}

export async function gitDiffStat(workingDir: string): Promise<string> {
  return invoke("git_diff_stat", { workingDir });
}

export async function gitDiffFile(workingDir: string, filePath: string, staged: boolean): Promise<string> {
  return invoke("git_diff_file", { workingDir, filePath, staged });
}

// Utility commands
export async function getGitBranch(
  workingDir: string,
): Promise<string | null> {
  return invoke("get_git_branch", { workingDir });
}

export async function isGitRepo(workingDir: string): Promise<boolean> {
  return invoke("is_git_repo", { workingDir });
}

export async function getClaudePath(): Promise<string> {
  return invoke("get_claude_path");
}

export async function getSetting(key: string): Promise<string | null> {
  return invoke("get_setting", { key });
}

export async function setSetting(key: string, value: string): Promise<void> {
  return invoke("set_setting", { key, value });
}

// Onboarding
/** Install + best-effort sign-in status for one agent CLI. */
export interface AgentStatus {
  installed: boolean;
  logged_in: boolean;
}

export interface AgentClis {
  claude: AgentStatus;
  codex: AgentStatus;
  gemini: AgentStatus;
  cursor: AgentStatus;
  grok: AgentStatus;
  /** Helper binaries — install-only (no auth concept). */
  node: boolean;
  tmux: boolean;
}

export async function checkAgentClis(): Promise<AgentClis> {
  return invoke("check_agent_clis");
}

/** Run the bundled agent-bus installer; returns its output. */
export async function setupAgentBus(): Promise<string> {
  return invoke("setup_agent_bus");
}

export async function getDefaultShell(): Promise<string> {
  return invoke("get_default_shell");
}

export async function spawnShellSession(
  workingDir: string,
  workspaceId: string,
): Promise<SessionInfo> {
  return invoke("spawn_shell_session", { workingDir, workspaceId });
}

// === New: Hub, Skills, Models, Utility Commands ===

export interface SkillInfo {
  name: string;
  description: string;
  category: string;
  /** "claude" | "codex" | "cursor" | "gemini" | "grok" */
  agent: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  description: string;
  speed: string;
  tier: string;
}

export interface GitHubRepo {
  name: string;
  full_name: string;
  description: string;
  url: string;
  clone_url: string;
  stars: number;
  language: string;
  updated_at: string;
  is_private: boolean;
  is_fork: boolean;
}

export async function listGithubRepos(
  owner?: string,
  limit?: number,
): Promise<GitHubRepo[]> {
  return invoke("list_github_repos", { owner: owner ?? null, limit: limit ?? null });
}

export async function searchGithubRepos(
  query: string,
  limit?: number,
): Promise<GitHubRepo[]> {
  return invoke("search_github_repos", { query, limit: limit ?? null });
}

export async function cloneRepo(
  url: string,
  targetDir?: string,
): Promise<string> {
  return invoke("clone_repo", { url, targetDir });
}

export async function getHomeDir(): Promise<string> {
  return invoke("get_home_dir");
}

export async function createProjectDir(name: string): Promise<string> {
  return invoke("create_project_dir", { name });
}

export async function listRecentDirs(): Promise<string[]> {
  return invoke("list_recent_dirs");
}

export interface RecentProject {
  path: string;
  name: string;
  last_opened: string;
  open_count: number;
  pinned: boolean;
  exists: boolean;
}

export async function listRecentProjects(limit?: number): Promise<RecentProject[]> {
  // Default to the full MRU (the launch screen has its own "View all" toggle), not
  // the backend's conservative 24 — otherwise projects past #24 never reach the UI.
  return invoke("list_recent_projects", { limit: limit ?? 500 });
}

export async function recordRecentProject(path: string): Promise<void> {
  return invoke("record_recent_project", { path });
}

export async function removeRecentProject(path: string): Promise<void> {
  return invoke("remove_recent_project", { path });
}

export async function pinRecentProject(path: string, pinned: boolean): Promise<void> {
  return invoke("pin_recent_project", { path, pinned });
}

export async function getProjectSearchRoots(): Promise<string[]> {
  return invoke("get_project_search_roots");
}

export async function setProjectSearchRoots(roots: string[]): Promise<void> {
  return invoke("set_project_search_roots", { roots });
}

export async function rescanProjectRoots(): Promise<RecentProject[]> {
  return invoke("rescan_project_roots");
}

export async function detectClaudeSkills(): Promise<SkillInfo[]> {
  return invoke("detect_claude_skills");
}

/** Aggregate skills across all supported agents (Claude/Codex/Cursor/Gemini/Grok). */
export async function detectAllSkills(projectDir?: string): Promise<SkillInfo[]> {
  return invoke("detect_all_skills", { projectDir: projectDir ?? null });
}

export async function getAvailableModels(): Promise<ModelInfo[]> {
  return invoke("get_available_models");
}

export async function sendToSession(
  sessionId: string,
  text: string,
): Promise<void> {
  return invoke("send_to_session", { sessionId, text });
}

export async function dirExists(path: string): Promise<boolean> {
  return invoke("dir_exists", { path });
}

// === Git Manager Commands ===

export interface GitStatusInfo {
  branch: string;
  ahead: number;
  behind: number;
  staged: GitFileChange[];
  unstaged: GitFileChange[];
  untracked: string[];
  has_remote: boolean;
  remote_url: string;
}

export interface GitFileChange {
  path: string;
  status: string;
}

export interface GitLogEntry {
  hash: string;
  short_hash: string;
  message: string;
  author: string;
  date: string;
}

export interface GitBranchInfo {
  name: string;
  is_current: boolean;
  is_remote: boolean;
  last_commit: string;
}

export async function gitStatus(workingDir: string): Promise<GitStatusInfo> {
  return invoke("git_status", { workingDir });
}

export async function gitPush(workingDir: string, setUpstream: boolean = false): Promise<string> {
  return invoke("git_push", { workingDir, setUpstream });
}

export async function gitPull(workingDir: string): Promise<string> {
  return invoke("git_pull", { workingDir });
}

export async function gitCommit(workingDir: string, message: string, stageAll: boolean = false): Promise<string> {
  return invoke("git_commit", { workingDir, message, stageAll });
}

export async function gitStageFile(workingDir: string, filePath: string): Promise<void> {
  return invoke("git_stage_file", { workingDir, filePath });
}

export async function gitUnstageFile(workingDir: string, filePath: string): Promise<void> {
  return invoke("git_unstage_file", { workingDir, filePath });
}

export async function gitCreateBranch(workingDir: string, branchName: string, checkout: boolean = true): Promise<void> {
  return invoke("git_create_branch", { workingDir, branchName, checkout });
}

export async function gitSwitchBranch(workingDir: string, branchName: string): Promise<void> {
  return invoke("git_switch_branch", { workingDir, branchName });
}

export async function gitListBranches(workingDir: string): Promise<GitBranchInfo[]> {
  return invoke("git_list_branches", { workingDir });
}

export async function gitLog(workingDir: string, count: number = 20): Promise<GitLogEntry[]> {
  return invoke("git_log", { workingDir, count });
}

export async function gitDiscardFile(workingDir: string, filePath: string): Promise<void> {
  return invoke("git_discard_file", { workingDir, filePath });
}

export async function gitStageAll(workingDir: string): Promise<void> {
  return invoke("git_stage_all", { workingDir });
}

export async function gitShowCommit(workingDir: string, hash: string): Promise<string> {
  return invoke("git_show_commit", { workingDir, hash });
}

// === MCP Manager Commands ===

export interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  scope: string;
  source_file: string;
  type: string; // "stdio" or "http"
  url: string | null;
  /** "claude" | "codex" | "cursor" | "gemini" | "grok" */
  agent: string;
  /** Whether this entry can be edited/removed (JSON agents only; TOML are view-only). */
  writable: boolean;
}

export interface McpServerEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
  disabled?: boolean;
}

export async function listMcps(projectDir?: string): Promise<McpServerConfig[]> {
  return invoke("list_mcps", { projectDir: projectDir ?? null });
}

export async function saveMcpConfig(configPath: string, servers: Record<string, McpServerEntry>): Promise<void> {
  return invoke("save_mcp_config", { configPath, servers });
}

export async function toggleMcpServer(configPath: string, serverName: string, enabled: boolean): Promise<void> {
  return invoke("toggle_mcp_server", { configPath, serverName, enabled });
}

export async function removeMcpServer(configPath: string, serverName: string): Promise<void> {
  return invoke("remove_mcp_server", { configPath, serverName });
}

export async function addMcpServer(
  configPath: string, name: string, command: string | null,
  args: string[], env: Record<string, string>,
  url?: string | null, serverType?: string | null,
  headers?: Record<string, string> | null,
): Promise<void> {
  return invoke("add_mcp_server", {
    configPath, name, command, args, env,
    url: url ?? null, serverType: serverType ?? null,
    headers: headers ?? null,
  });
}

// === File Tree Commands ===

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileEntry[];
  is_gitignored: boolean;
}

export async function listDirectory(path: string, maxDepth?: number): Promise<FileEntry[]> {
  return invoke("list_directory", { path, maxDepth: maxDepth ?? null });
}

export async function createFolder(parentPath: string, folderName: string): Promise<string> {
  return invoke("create_folder", { parentPath, folderName });
}

// === Git Setup Wizard Commands ===

export interface GitSetupStatus {
  git_installed: boolean;
  git_user_name: string | null;
  git_user_email: string | null;
  gh_installed: boolean;
  gh_authenticated: boolean;
  gh_username: string | null;
  ssh_key_exists: boolean;
  credential_helper_configured: boolean;
}

export async function checkGitSetup(): Promise<GitSetupStatus> {
  return invoke("check_git_setup");
}

export async function setGitConfig(name: string, email: string): Promise<void> {
  return invoke("set_git_config", { name, email });
}

export async function runGhAuthLogin(): Promise<string> {
  return invoke("run_gh_auth_login");
}

export async function getGhInstallInstructions(): Promise<string> {
  return invoke("get_gh_install_instructions");
}

export async function runGhSetupGit(): Promise<void> {
  return invoke("run_gh_setup_git");
}

export interface DeviceFlowStart {
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval: number;
  expires_in: number;
}

export async function startGithubDeviceFlow(): Promise<DeviceFlowStart> {
  return invoke("start_github_device_flow");
}

export interface TokenPollResult {
  token: string | null;
  pending: boolean;
  error: string | null;
}

export async function pollGithubToken(deviceCode: string): Promise<TokenPollResult> {
  return invoke("poll_github_token", { deviceCode });
}

export async function saveGithubToken(token: string): Promise<void> {
  return invoke("save_github_token", { token });
}

// === Code Viewer Commands ===

export async function readFileContents(filePath: string): Promise<string> {
  return invoke("read_file_contents", { filePath });
}

export async function writeFileContents(filePath: string, content: string): Promise<void> {
  return invoke("write_file_contents", { filePath, content });
}

// === Repo Quick Status ===

export interface RepoQuickStatus {
  is_git: boolean;
  has_remote: boolean;
  branch: string | null;
}

export async function checkRepoStatus(path: string): Promise<RepoQuickStatus> {
  return invoke("check_repo_status", { path });
}

// === GitHub Identity ===

export interface GitHubIdentity {
  username: string;
  orgs: string[];
}

export async function getGithubIdentity(): Promise<GitHubIdentity> {
  return invoke("get_github_identity");
}

// === Quick Publish / Save ===

export interface QuickPublishResult {
  success: boolean;
  message: string;
  commit_hash: string;
  files_changed: number;
}

export async function quickPublish(dir: string): Promise<QuickPublishResult> {
  return invoke("quick_publish", { dir });
}

export async function quickSave(dir: string): Promise<QuickPublishResult> {
  return invoke("quick_save", { dir });
}

// === Env Allow Commands ===

export async function getEnvAllowStatus(workingDir: string): Promise<boolean> {
  return invoke<boolean>("get_env_allow_status", { workingDir });
}

export async function toggleEnvAllow(workingDir: string, enabled: boolean): Promise<void> {
  return invoke<void>("toggle_env_allow", { workingDir, enabled });
}

// === File Operations ===

export async function renameFile(oldPath: string, newName: string): Promise<string> {
  return invoke("rename_file", { oldPath, newName });
}

export async function deleteFile(filePath: string): Promise<void> {
  return invoke("delete_file", { filePath });
}

export async function moveFile(sourcePath: string, destDir: string): Promise<string> {
  return invoke("move_file", { sourcePath, destDir });
}

export async function copyFile(sourcePath: string, destDir: string): Promise<string> {
  return invoke("copy_file", { sourcePath, destDir });
}

// === Project Search ===

export interface SearchResult {
  file_path: string;
  line_number: number;
  line_content: string;
  match_start: number;
  match_end: number;
}

export async function searchFiles(
  workingDir: string,
  query: string,
  caseSensitive?: boolean,
  useRegex?: boolean,
  maxResults?: number,
): Promise<SearchResult[]> {
  return invoke("search_files", {
    workingDir,
    query,
    caseSensitive: caseSensitive ?? false,
    useRegex: useRegex ?? false,
    maxResults: maxResults ?? 500,
  });
}

// === Additional Git Commands ===

export interface GitBlameEntry {
  hash: string;
  author: string;
  date: string;
  line_number: number;
  content: string;
}

export interface GitStashEntry {
  index: string;
  message: string;
}

export async function gitInit(workingDir: string): Promise<string> {
  return invoke("git_init", { workingDir });
}

export async function gitDeleteBranch(workingDir: string, branchName: string, force: boolean): Promise<string> {
  return invoke("git_delete_branch", { workingDir, branchName, force });
}

export async function gitMergeBranch(workingDir: string, branchName: string): Promise<string> {
  return invoke("git_merge_branch", { workingDir, branchName });
}

export async function gitAmendCommit(workingDir: string, message?: string): Promise<string> {
  return invoke("git_amend_commit", { workingDir, message: message ?? null });
}

export async function gitDiscardAll(workingDir: string): Promise<string> {
  return invoke("git_discard_all", { workingDir });
}

export async function gitBlameFile(workingDir: string, filePath: string): Promise<GitBlameEntry[]> {
  return invoke("git_blame_file", { workingDir, filePath });
}

export async function gitTag(workingDir: string, tagName: string, message?: string): Promise<string> {
  return invoke("git_tag", { workingDir, tagName, message: message ?? null });
}

export async function gitListTags(workingDir: string): Promise<string[]> {
  return invoke("git_list_tags", { workingDir });
}

export async function gitCherryPick(workingDir: string, commitHash: string): Promise<string> {
  return invoke("git_cherry_pick", { workingDir, commitHash });
}

export async function gitRevertCommit(workingDir: string, commitHash: string): Promise<string> {
  return invoke("git_revert_commit", { workingDir, commitHash });
}

export async function gitStashList(workingDir: string): Promise<GitStashEntry[]> {
  return invoke("git_stash_list", { workingDir });
}

export async function gitStashDrop(workingDir: string, index: number): Promise<string> {
  return invoke("git_stash_drop", { workingDir, index });
}

export async function gitStashApply(workingDir: string, index: number): Promise<string> {
  return invoke("git_stash_apply", { workingDir, index });
}

export async function gitUnstageAll(workingDir: string): Promise<string> {
  return invoke("git_unstage_all", { workingDir });
}

export async function gitTagDelete(workingDir: string, tagName: string): Promise<string> {
  return invoke("git_tag_delete", { workingDir, tagName });
}

export async function gitRenameBranch(workingDir: string, oldName: string, newName: string): Promise<string> {
  return invoke("git_rename_branch", { workingDir, oldName, newName });
}

export interface GitRemote {
  name: string;
  url: string;
}

export async function gitListRemotes(workingDir: string): Promise<GitRemote[]> {
  return invoke("git_list_remotes", { workingDir });
}

export async function gitAddRemote(workingDir: string, name: string, url: string): Promise<string> {
  return invoke("git_add_remote", { workingDir, name, url });
}

export async function gitRemoveRemote(workingDir: string, name: string): Promise<string> {
  return invoke("git_remove_remote", { workingDir, name });
}

// === Git Hunk Staging ===

export async function gitStageHunk(workingDir: string, filePath: string, hunkHeader: string): Promise<void> {
  return invoke("git_stage_hunk", { workingDir, filePath, hunkHeader });
}

// === Dependency Graph ===

export interface DepNode { path: string; name: string; }
export interface DepEdge { from: string; to: string; }
export interface DepGraph { nodes: DepNode[]; edges: DepEdge[]; }

export async function analyzeDependencies(workingDir: string): Promise<DepGraph> {
  return invoke("analyze_dependencies", { workingDir });
}

// === Notes Persistence ===

export interface NoteMeta {
  id: string;
  workspace_id: string;
  title: string | null;
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
  pinned_to: string | null;
  created_at: number;
  updated_at: number;
}

export interface NoteRecord extends NoteMeta {
  text: string;
}

export async function notesList(workspaceId: string): Promise<NoteRecord[]> {
  return invoke("notes_list", { workspaceId });
}

export async function notesWrite(meta: NoteMeta, text: string): Promise<void> {
  return invoke("notes_write", { meta, text });
}

export async function notesDelete(workspaceId: string, noteId: string): Promise<void> {
  return invoke("notes_delete", { workspaceId, noteId });
}

// === System Memory ===

export interface SystemMemoryInfo {
  total_memory_mb: number;
  available_memory_mb: number;
  used_memory_mb: number;
  usage_percent: number;
}

export async function getSystemMemory(): Promise<SystemMemoryInfo> {
  return invoke("get_system_memory");
}

// === AI Code Review (BYOK OpenAI) ===

export type ReviewSeverity = "critical" | "high" | "medium" | "low" | "nit";

export interface ReviewFinding {
  severity: ReviewSeverity;
  file: string;
  line: number | null;
  title: string;
  why: string;
  fix: string;
}

export interface ReviewItem {
  dimension: string;
  label: string;
  summary: string;
  findings: ReviewFinding[];
  error?: string | null;
}

export interface ReviewUsage {
  used: number;
  limit: number;
  remaining: number;
}

export interface ReviewResponse {
  reviews: ReviewItem[];
  truncated: boolean;
  /** Friendly model name (e.g. "Claude Sonnet 4.6"), shown in the review header. */
  model?: string | null;
  /** Optional usage info (unused for BYOK). */
  usage?: ReviewUsage | null;
}

/** The unified diff (vs HEAD) the review would run on, for the active workspace. */
export async function getActiveDiff(workingDir: string): Promise<string> {
  return invoke("get_active_diff", { workingDir });
}

/** Run an AI code review on the active diff (BYOK OpenAI). Throws a user-safe message on failure. */
export async function runReview(workingDir: string, dimensions?: string[]): Promise<ReviewResponse> {
  return invoke("run_review", { workingDir, dimensions: dimensions ?? null });
}

/** Pro: generate a git commit message from the staged diff (cheap model). Throws a user-safe message. */
export async function generateCommitMessage(workingDir: string, conventional?: boolean): Promise<string> {
  return invoke("ai_commit_message", { workingDir, conventional: conventional ?? null });
}

/** Pro: name a terminal from recent output (cheap model). Pass the exact text to summarize. */
export async function summarizeTerminal(text: string): Promise<string> {
  return invoke("summarize_terminal", { text });
}

// === Pro: Coding Analytics ===

export interface TokenTotals {
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
  est_cost_usd: number;
  sessions: number;
  assistant_turns: number;
  active_days: number;
  first_activity: string | null;
  last_activity: string | null;
}

export interface DayBucket {
  date: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_tokens: number;
  est_cost_usd: number;
  sessions: number;
}

export interface ModelBucket {
  model: string;
  total_tokens: number;
  est_cost_usd: number;
  sessions: number;
}

export interface ProjectBucket {
  project: string;
  name: string;
  total_tokens: number;
  est_cost_usd: number;
  sessions: number;
  last_active: string | null;
}

export interface ToolBucket {
  tool: string;
  total_tokens: number;
  est_cost_usd: number;
  sessions: number;
}

export interface CodingAnalytics {
  range_days: number;
  totals: TokenTotals;
  by_day: DayBucket[];
  by_model: ModelBucket[];
  by_project: ProjectBucket[];
  by_tool: ToolBucket[];
  cost_partial: boolean;
  cost_note: string;
}

/** Local coding analytics derived from the agent CLIs' own logs. `rangeDays<=0` = all-time. */
export async function getCodingAnalytics(rangeDays?: number): Promise<CodingAnalytics> {
  return invoke("get_coding_analytics", { rangeDays: rangeDays ?? null });
}

// Event listeners
export function onPtyOutput(
  callback: (data: PtyOutput) => void,
): Promise<UnlistenFn> {
  return listen<PtyOutput>("pty-output", (event) => {
    callback(event.payload);
  });
}

export function onSessionEnded(
  callback: (data: { session_id: string }) => void,
): Promise<UnlistenFn> {
  return listen<{ session_id: string }>("session-ended", (event) => {
    callback(event.payload);
  });
}

// ── Voice control (BYOK OpenAI Realtime) ──────────────────────────────────

export interface VoiceState {
  active: boolean;
  workspaceId?: string;
  micPaused?: boolean;
  elapsedMs?: number;
}

export async function voiceStart(workspaceId: string): Promise<void> {
  return invoke("voice_start", { workspaceId });
}

export async function voiceStop(): Promise<void> {
  return invoke("voice_stop");
}

export async function voiceState(): Promise<VoiceState> {
  return invoke("voice_state");
}

export async function voiceSetApiKey(key: string): Promise<void> {
  return invoke("voice_set_api_key", { key });
}

export async function voiceKeyStatus(): Promise<boolean> {
  return invoke("voice_key_status");
}

export async function voiceClearApiKey(): Promise<void> {
  return invoke("voice_clear_api_key");
}

export async function voiceSetMicPaused(paused: boolean): Promise<void> {
  return invoke("voice_set_mic_paused", { paused });
}

/** Reply to a Rust-initiated voice tool round-trip (spawn_agent). */
export async function voiceToolResponse(requestId: string, result: unknown): Promise<void> {
  return invoke("voice_tool_response", { requestId, result });
}

/** Copy text to the system clipboard (via Rust — webview clipboard is unreliable). */
export async function clipboardWrite(text: string): Promise<void> {
  return invoke("clipboard_write", { text });
}

/** Set (or clear, with null) the global "summon Max" hotkey — applies immediately. */
export async function voiceSetSummon(combo: string | null): Promise<void> {
  return invoke("voice_set_summon", { combo });
}

/** Ensure macOS notification permission (prompts if needed). Returns whether allowed. */
export async function voiceRequestNotifications(): Promise<boolean> {
  return invoke("voice_request_notifications");
}
