use anyhow::{Context, Result};
use directories::ProjectDirs;
use std::path::PathBuf;

pub fn project_dirs() -> Result<ProjectDirs> {
    ProjectDirs::from("com", "terminus", "terminus")
        .context("could not determine a platform-specific config directory")
}

pub fn data_dir() -> Result<PathBuf> {
    let dirs = project_dirs()?;
    let dir = dirs.data_dir().to_path_buf();
    std::fs::create_dir_all(&dir)
        .with_context(|| format!("create data dir {}", dir.display()))?;
    Ok(dir)
}

pub fn db_path() -> Result<PathBuf> {
    Ok(data_dir()?.join("terminus.db"))
}
