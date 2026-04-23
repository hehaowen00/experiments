use anyhow::{Context, Result, bail};
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::domain::worktree::Worktree;

pub fn list(repo: &Path) -> Result<Vec<Worktree>> {
    let output = Command::new("git")
        .args(["worktree", "list", "--porcelain"])
        .current_dir(repo)
        .output()
        .context("run git worktree list")?;
    if !output.status.success() {
        bail!(
            "git worktree list failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    Ok(parse_porcelain(&String::from_utf8_lossy(&output.stdout)))
}

fn parse_porcelain(input: &str) -> Vec<Worktree> {
    let mut out = Vec::new();
    let mut first = true;
    for block in input.split("\n\n") {
        let block = block.trim();
        if block.is_empty() {
            continue;
        }
        let mut wt = Worktree {
            path: PathBuf::new(),
            head: None,
            branch: None,
            detached: false,
            bare: false,
            prunable: false,
            is_main: first,
        };
        first = false;
        for line in block.lines() {
            if let Some(rest) = line.strip_prefix("worktree ") {
                wt.path = PathBuf::from(rest);
            } else if let Some(rest) = line.strip_prefix("HEAD ") {
                wt.head = Some(rest.to_string());
            } else if let Some(rest) = line.strip_prefix("branch ") {
                wt.branch = Some(rest.to_string());
            } else if line == "bare" {
                wt.bare = true;
            } else if line == "detached" {
                wt.detached = true;
            } else if line.starts_with("prunable") {
                wt.prunable = true;
            }
        }
        if !wt.path.as_os_str().is_empty() {
            out.push(wt);
        }
    }
    out
}

pub struct AddOptions<'a> {
    pub path: &'a Path,
    pub branch: Option<&'a str>,
    pub new_branch: Option<&'a str>,
    pub start_point: Option<&'a str>,
    pub detach: bool,
    pub force: bool,
}

pub fn add(repo: &Path, opts: AddOptions<'_>) -> Result<()> {
    let mut cmd = Command::new("git");
    cmd.args(["worktree", "add"]).current_dir(repo);
    if opts.force {
        cmd.arg("--force");
    }
    if opts.detach {
        cmd.arg("--detach");
    }
    if let Some(nb) = opts.new_branch {
        cmd.arg("-b").arg(nb);
    }
    cmd.arg(opts.path);
    if let Some(b) = opts.branch {
        cmd.arg(b);
    } else if let Some(sp) = opts.start_point {
        cmd.arg(sp);
    }
    let output = cmd.output().context("run git worktree add")?;
    if !output.status.success() {
        bail!(
            "git worktree add failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(())
}

pub fn remove(repo: &Path, wt_path: &Path, force: bool) -> Result<()> {
    let mut cmd = Command::new("git");
    cmd.args(["worktree", "remove"]).current_dir(repo);
    if force {
        cmd.arg("--force");
    }
    cmd.arg(wt_path);
    let output = cmd.output().context("run git worktree remove")?;
    if !output.status.success() {
        bail!(
            "git worktree remove failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(())
}

pub fn prune(repo: &Path) -> Result<()> {
    let output = Command::new("git")
        .args(["worktree", "prune"])
        .current_dir(repo)
        .output()
        .context("run git worktree prune")?;
    if !output.status.success() {
        bail!(
            "git worktree prune failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(())
}

/// Suggest a sibling path `<repo>-<sanitized-branch>`, adding `-2`, `-3`, … on collision.
pub fn suggest_path(repo: &Path, branch: &str) -> PathBuf {
    let parent = repo.parent().unwrap_or_else(|| Path::new("."));
    let repo_name = repo
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("worktree");
    let sanitized: String = branch
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect();
    let base = parent.join(format!("{}-{}", repo_name, sanitized));
    if !base.exists() {
        return base;
    }
    for n in 2..1000 {
        let candidate = parent.join(format!("{}-{}-{}", repo_name, sanitized, n));
        if !candidate.exists() {
            return candidate;
        }
    }
    base
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_porcelain_block() {
        let input = "worktree /repo\nHEAD abc123\nbranch refs/heads/main\n\nworktree /repo-feat\nHEAD def456\nbranch refs/heads/feat/x\n";
        let wts = parse_porcelain(input);
        assert_eq!(wts.len(), 2);
        assert!(wts[0].is_main);
        assert_eq!(wts[0].branch.as_deref(), Some("refs/heads/main"));
        assert_eq!(wts[1].path, PathBuf::from("/repo-feat"));
    }

    #[test]
    fn parses_detached_and_prunable() {
        let input = "worktree /w\nHEAD abc\ndetached\nprunable gitdir file points to non-existent location";
        let wts = parse_porcelain(input);
        assert_eq!(wts.len(), 1);
        assert!(wts[0].detached);
        assert!(wts[0].prunable);
    }
}
