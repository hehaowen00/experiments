use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
    pub created_at: String,
    pub last_used: Option<String>,
}

impl Project {
    pub fn new(path: PathBuf) -> Self {
        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("(project)")
            .to_string();
        Self {
            id: ksuid::Ksuid::generate().to_base62(),
            name,
            path,
            created_at: String::new(),
            last_used: None,
        }
    }
}
