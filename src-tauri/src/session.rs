use chrono::Utc;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SessionStatus {
    Idle,
    Running,
    Waiting,
    Error,
    Dead,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub workspace_id: String,
    pub working_dir: String,
    pub command: String,
    pub git_branch: Option<String>,
    pub status: SessionStatus,
    pub created_at: String,
    pub pane_number: u32,
    pub worktree_path: Option<String>,
    /// User-assigned display name (e.g. "Backend API", "Frontend"). None = auto-detected.
    pub name: Option<String>,
}

impl Session {
    pub fn new(
        id: String,
        workspace_id: String,
        working_dir: String,
        command: String,
        pane_number: u32,
    ) -> Self {
        Self {
            id,
            workspace_id,
            working_dir,
            command,
            git_branch: None,
            status: SessionStatus::Idle,
            created_at: Utc::now().to_rfc3339(),
            pane_number,
            worktree_path: None,
            name: None,
        }
    }
}
