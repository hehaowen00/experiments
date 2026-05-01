use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, params};
use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;

use crate::config;
use crate::domain::project::Project;

#[derive(Debug, Clone)]
pub struct ClaudeSession {
    pub session_id: String,
    pub cwd: PathBuf,
}

pub type Db = Rc<RefCell<Connection>>;

pub fn open() -> Result<Db> {
    let path = config::db_path()?;
    let conn = Connection::open(&path)
        .with_context(|| format!("open sqlite at {}", path.display()))?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    migrate(&conn)?;
    Ok(Rc::new(RefCell::new(conn)))
}

fn migrate(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS projects (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            path       TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            last_used  TEXT
        );

        CREATE TABLE IF NOT EXISTS worktree_meta (
            wt_path  TEXT PRIMARY KEY,
            nickname TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS claude_sessions (
            project_id  TEXT NOT NULL,
            slot        INTEGER NOT NULL,
            session_id  TEXT NOT NULL UNIQUE,
            cwd         TEXT NOT NULL,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            last_active TEXT,
            PRIMARY KEY (project_id, slot),
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS project_folders (
            project_id TEXT NOT NULL,
            path       TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (project_id, path),
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        "#,
    )?;
    Ok(())
}

pub fn list_projects(db: &Db) -> Result<Vec<Project>> {
    let conn = db.borrow();
    let mut stmt = conn.prepare(
        "SELECT id, name, path, created_at, last_used FROM projects
         ORDER BY COALESCE(last_used, created_at) DESC",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get::<_, String>(2)?.into(),
                created_at: row.get(3)?,
                last_used: row.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn find_project_by_path(db: &Db, path: &str) -> Result<Option<Project>> {
    let conn = db.borrow();
    let p = conn
        .query_row(
            "SELECT id, name, path, created_at, last_used FROM projects WHERE path = ?1",
            params![path],
            |row| {
                Ok(Project {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    path: row.get::<_, String>(2)?.into(),
                    created_at: row.get(3)?,
                    last_used: row.get(4)?,
                })
            },
        )
        .optional()?;
    Ok(p)
}

pub fn insert_project(db: &Db, project: &Project) -> Result<()> {
    let conn = db.borrow();
    conn.execute(
        "INSERT INTO projects (id, name, path) VALUES (?1, ?2, ?3)",
        params![project.id, project.name, project.path.to_string_lossy()],
    )?;
    Ok(())
}

pub fn touch_last_used(db: &Db, id: &str) -> Result<()> {
    let conn = db.borrow();
    conn.execute(
        "UPDATE projects SET last_used = datetime('now') WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}

pub fn delete_project(db: &Db, id: &str) -> Result<()> {
    let conn = db.borrow();
    conn.execute("DELETE FROM projects WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn list_claude_sessions(db: &Db, project_id: &str) -> Result<Vec<ClaudeSession>> {
    let conn = db.borrow();
    let mut stmt = conn.prepare(
        "SELECT session_id, cwd FROM claude_sessions
         WHERE project_id = ?1 ORDER BY slot",
    )?;
    let rows = stmt
        .query_map(params![project_id], |row| {
            Ok(ClaudeSession {
                session_id: row.get(0)?,
                cwd: row.get::<_, String>(1)?.into(),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn next_claude_slot(db: &Db, project_id: &str) -> Result<i64> {
    let conn = db.borrow();
    let next: i64 = conn.query_row(
        "SELECT COALESCE(MAX(slot), -1) + 1 FROM claude_sessions WHERE project_id = ?1",
        params![project_id],
        |row| row.get(0),
    )?;
    Ok(next)
}

pub fn insert_claude_session(
    db: &Db,
    project_id: &str,
    slot: i64,
    session_id: &str,
    cwd: &std::path::Path,
) -> Result<()> {
    let conn = db.borrow();
    conn.execute(
        "INSERT INTO claude_sessions (project_id, slot, session_id, cwd)
         VALUES (?1, ?2, ?3, ?4)",
        params![project_id, slot, session_id, cwd.to_string_lossy()],
    )?;
    Ok(())
}

pub fn delete_claude_session(db: &Db, session_id: &str) -> Result<()> {
    let conn = db.borrow();
    conn.execute(
        "DELETE FROM claude_sessions WHERE session_id = ?1",
        params![session_id],
    )?;
    Ok(())
}

pub fn touch_claude_session(db: &Db, session_id: &str) -> Result<()> {
    let conn = db.borrow();
    conn.execute(
        "UPDATE claude_sessions SET last_active = datetime('now') WHERE session_id = ?1",
        params![session_id],
    )?;
    Ok(())
}

pub fn list_project_folders(db: &Db, project_id: &str) -> Result<Vec<PathBuf>> {
    let conn = db.borrow();
    let mut stmt = conn.prepare(
        "SELECT path FROM project_folders
         WHERE project_id = ?1 ORDER BY path",
    )?;
    let rows = stmt
        .query_map(params![project_id], |row| {
            Ok(row.get::<_, String>(0)?.into())
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn insert_project_folder(db: &Db, project_id: &str, path: &std::path::Path) -> Result<()> {
    let conn = db.borrow();
    conn.execute(
        "INSERT OR IGNORE INTO project_folders (project_id, path) VALUES (?1, ?2)",
        params![project_id, path.to_string_lossy()],
    )?;
    Ok(())
}

pub fn delete_project_folder(db: &Db, project_id: &str, path: &std::path::Path) -> Result<()> {
    let conn = db.borrow();
    conn.execute(
        "DELETE FROM project_folders WHERE project_id = ?1 AND path = ?2",
        params![project_id, path.to_string_lossy()],
    )?;
    Ok(())
}
