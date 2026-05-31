use std::process::Command;

pub struct WorktreeManager;

impl WorktreeManager {
    /// Check if a directory is inside a git repo
    pub fn is_git_repo(dir: &str) -> bool {
        Command::new("git")
            .args(["rev-parse", "--is-inside-work-tree"])
            .current_dir(dir)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    /// Get the root of the git repo
    pub fn git_root(dir: &str) -> Option<String> {
        Command::new("git")
            .args(["rev-parse", "--show-toplevel"])
            .current_dir(dir)
            .output()
            .ok()
            .and_then(|o| {
                if o.status.success() {
                    String::from_utf8(o.stdout).ok().map(|s| s.trim().to_string())
                } else {
                    None
                }
            })
    }

    /// Get current branch name
    pub fn current_branch(dir: &str) -> Option<String> {
        Command::new("git")
            .args(["rev-parse", "--abbrev-ref", "HEAD"])
            .current_dir(dir)
            .output()
            .ok()
            .and_then(|o| {
                if o.status.success() {
                    String::from_utf8(o.stdout).ok().map(|s| s.trim().to_string())
                } else {
                    None
                }
            })
    }

    /// Create a git worktree for isolated session work
    pub fn create_worktree(repo_dir: &str, session_id: &str) -> Result<(String, String), String> {
        let root = Self::git_root(repo_dir)
            .ok_or_else(|| "Not a git repository".to_string())?;

        let short_id = &session_id[..8.min(session_id.len())];
        let branch_name = format!("codegrid/session-{short_id}");
        let worktree_dir = format!("{root}/.worktrees/codegrid-{short_id}");

        // Create the .worktrees directory
        let worktrees_parent = format!("{root}/.worktrees");
        std::fs::create_dir_all(&worktrees_parent)
            .map_err(|e| format!("Failed to create worktrees dir: {e}"))?;

        // Create the worktree with a new branch
        let output = Command::new("git")
            .args(["worktree", "add", "-b", &branch_name, &worktree_dir])
            .current_dir(&root)
            .output()
            .map_err(|e| format!("Failed to run git worktree add: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            // If branch already exists, try without -b
            if stderr.contains("already exists") {
                let output2 = Command::new("git")
                    .args(["worktree", "add", &worktree_dir, &branch_name])
                    .current_dir(&root)
                    .output()
                    .map_err(|e| format!("Failed to run git worktree add: {e}"))?;

                if !output2.status.success() {
                    return Err(format!(
                        "Failed to create worktree: {}",
                        String::from_utf8_lossy(&output2.stderr)
                    ));
                }
            } else {
                return Err(format!("Failed to create worktree: {stderr}"));
            }
        }

        Ok((worktree_dir, branch_name))
    }

    /// Remove a git worktree
    pub fn remove_worktree(repo_dir: &str, worktree_path: &str) -> Result<(), String> {
        // Check for uncommitted changes first
        let status_output = Command::new("git")
            .args(["status", "--porcelain"])
            .current_dir(worktree_path)
            .output()
            .map_err(|e| format!("Failed to check git status: {e}"))?;

        let status = String::from_utf8_lossy(&status_output.stdout);
        if !status.trim().is_empty() {
            return Err("Worktree has uncommitted changes. Commit or stash them first.".to_string());
        }

        let root = Self::git_root(repo_dir)
            .ok_or_else(|| "Not a git repository".to_string())?;

        let output = Command::new("git")
            .args(["worktree", "remove", worktree_path, "--force"])
            .current_dir(&root)
            .output()
            .map_err(|e| format!("Failed to remove worktree: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Failed to remove worktree: {}", stderr.trim()));
        }

        Ok(())
    }

    /// List active worktrees
    #[allow(dead_code)]
    pub fn list_worktrees(repo_dir: &str) -> Vec<String> {
        Command::new("git")
            .args(["worktree", "list", "--porcelain"])
            .current_dir(repo_dir)
            .output()
            .ok()
            .map(|o| {
                String::from_utf8_lossy(&o.stdout)
                    .lines()
                    .filter(|l| l.starts_with("worktree "))
                    .map(|l| l.trim_start_matches("worktree ").to_string())
                    .collect()
            })
            .unwrap_or_default()
    }
}
