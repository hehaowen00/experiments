use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, params};
use std::cell::RefCell;
use std::rc::Rc;

use crate::config;
use crate::domain::project::Project;

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
