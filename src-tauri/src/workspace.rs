use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub layout_json: Option<String>,
    pub created_at: String,
    pub is_active: bool,
    pub repo_path: Option<String>,
}

impl Workspace {
    pub fn new(id: String, name: String) -> Self {
        Self {
            id,
            name,
            layout_json: None,
            created_at: chrono::Utc::now().to_rfc3339(),
            is_active: false,
            repo_path: None,
        }
    }

    pub fn with_repo(mut self, repo_path: String) -> Self {
        self.name = std::path::Path::new(&repo_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(&self.name)
            .to_string();
        self.repo_path = Some(repo_path);
        self
    }
}
