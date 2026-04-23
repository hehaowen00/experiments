use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct Worktree {
    pub path: PathBuf,
    pub head: Option<String>,
    pub branch: Option<String>,
    pub detached: bool,
    pub bare: bool,
    pub prunable: bool,
    pub is_main: bool,
}

impl Worktree {
    pub fn display_label(&self) -> String {
        if let Some(b) = &self.branch {
            b.trim_start_matches("refs/heads/").to_string()
        } else if self.detached {
            format!(
                "(detached{})",
                self.head
                    .as_deref()
                    .map(|h| format!(" {}", &h[..h.len().min(7)]))
                    .unwrap_or_default()
            )
        } else {
            self.path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("(worktree)")
                .to_string()
        }
    }
}
