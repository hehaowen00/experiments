# GitSync User Manual

## Overview

GitSync is a desktop Git client built with Electron and Solid.js. It provides a visual interface for managing Git repositories with features including commit history visualization, staging, branching, stashing, interactive rebase, bisect, file history, peer-to-peer repository sharing, and more.

---

## Getting Started

### Installation

```bash
npm install
npm run start    # Build UI + launch app
```

Or build a distributable:

```bash
npm run dist:mac    # macOS DMG
npm run dist:win    # Windows installer
npm run dist:linux  # Linux AppImage
```

GitSync requires Git to be installed on your system. On first launch it will prompt you to install Git if it is not found.

### Adding a Repository

From the home screen, click **Add Repo** to register an existing Git repository or **Init** to create a new one. Repositories appear as cards that can be organized into categories via drag-and-drop.

### Opening a Repository

Click a repository card to open the workspace. The workspace has three tabs: **Changes**, **History**, and **Remotes**.

---

## Repository Library

The home screen shows all registered repositories.

- **Categories** — Create categories to organize repos. Drag repo cards between categories or into "Uncategorized".
- **Pinning** — Pin frequently used repos so they appear at the top.
- **Search** — Filter repos by name.
- **Quick Switch** — Press `Ctrl+P` (or `Cmd+P` on macOS) from any workspace to quickly switch between repos.

---

## Workspace Header

The header bar at the top of the workspace shows:

- **Repo name** — Click to open the quick switcher.
- **Branch name** — Shows the current branch. Click to jump to the Remotes tab.
- **Ahead/Behind indicators** — Shows how many commits you are ahead or behind the upstream branch.
- **Stash** — Push current changes to the stash.
- **Fetch** — Fetch from all remotes.
- **Pull** — Pull from the upstream branch.
- **Push** — Push to the upstream branch.
- **Refresh** — Manually refresh the workspace state.

---

## Changes Tab

The Changes tab is where you stage files, view diffs, resolve conflicts, and commit.

### File Sections

Files are organized into sections:

- **Conflicts** — Files with merge/rebase conflicts. Appears only during merge or rebase operations.
- **Staged** — Files added to the index, ready to commit.
- **Unstaged** — Tracked files with modifications not yet staged.
- **Untracked** — New files not yet tracked by Git.

Each section can be expanded or collapsed. Folders within sections expand independently.

### Staging and Unstaging

- Click the **+** button next to a file to stage it, or **-** to unstage it.
- Use the section header buttons to **Stage All** or **Unstage All**.
- Right-click a file or folder for more options (stage, unstage, discard, delete, file history).

### Viewing Diffs

Click any file to view its diff in the right panel. The diff viewer shows added lines in green and removed lines in red, with line numbers and hunk headers.

For untracked files, the full file content is shown.

### Committing

1. Stage the files you want to commit.
2. Type a commit message in the text box at the bottom of the Changes tab.
3. Click **Commit** (or press `Ctrl+Enter`).

The **Amend** button lets you modify the most recent commit. It pre-fills the previous commit message.

### Conflict Resolution

During a merge or rebase, conflicted files appear in the Conflicts section. For each conflicted file you can:

- **Resolve Ours** — Accept the current branch's version.
- **Resolve Theirs** — Accept the incoming branch's version.
- **View Conflict Diff** — See the conflict markers.

After resolving, stage the file and continue the merge/rebase.

### Pre-Commit Actions

Actions are custom scripts that run before each commit. Configure them in **Settings > Actions**. If any action fails, the commit is blocked and the error is displayed.

### Patches

- **Export Patch** — Export staged changes as a patch file.
- **Apply Patch** — Import and apply a patch file.

---

## History Tab

The History tab shows the commit log with an SVG graph visualization.

### Graph

The graph column renders branch and merge lines as colored SVG paths. Each branch gets a distinct color lane. Merge commits show connections between lanes.

### Toolbar

- **Branch selector** — View history for the current branch, all branches, or a specific branch.
- **Search** — Filter commits by hash, author, or message. Press Enter or wait 300ms for auto-search.
- **Topo order toggle** — Switch between date order (default) and topological order. Topological order groups branch commits together for cleaner graphs; date order shows commits chronologically.
- **Refresh** — Reload the log.

### Commit Details

Click a commit to view its details in a split panel:

- **Header** — Hash, author, email, date, parent commits.
- **Body** — Full commit message.
- **Changed files** — List of files with addition/deletion counts. Click a file to expand its diff.

The split panel is resizable by dragging the divider.

### Commit Context Menu

Right-click a commit for operations:

- **Cherry-pick** — Apply the commit to the current branch.
- **Revert** — Create a new commit that undoes the selected commit.
- **Interactive Rebase** — Start an interactive rebase from the selected commit.
- **Bisect (bad)** — Begin a bisect session marking this commit as bad.
- **Bisect (good)** — When bisect selection is active, mark a commit as the known good point.
- **Drop Commit** — Remove the commit from history (uses rebase internally).

### Infinite Scroll

The log loads 50 commits at a time. Scroll to the bottom to automatically load more.

---

## Interactive Rebase

Interactive rebase lets you rewrite commit history by reordering, editing, squashing, or dropping commits.

### Starting a Rebase

Right-click a commit in the History tab and select **Interactive Rebase**. This opens the rebase editor showing all commits from that point to HEAD.

### Actions

For each commit, choose an action from the dropdown:

| Action | Description |
|--------|-------------|
| **pick** | Keep the commit as-is |
| **reword** | Keep the commit but edit the message |
| **squash** | Combine with the previous commit, keeping both messages |
| **fixup** | Combine with the previous commit, discarding this message |
| **drop** | Remove the commit entirely |

### Reordering

Drag commits to reorder them, or use the up/down arrow buttons.

### Executing

Click **Start Rebase** to execute. If conflicts arise, the rebase pauses and a banner appears with **Continue** and **Abort** buttons. Resolve conflicts in the Changes tab, stage them, then click Continue.

---

## File History

View the full commit history of a specific file, including across renames.

### Opening File History

Right-click a file in the Changes tab and select **File History**. A modal opens with a split view.

### Layout

- **Left panel** — Chronological list of commits that modified the file. Shows hash, date, subject, and author.
- **Right panel** — Diff for the selected commit, showing only changes to that file.

Click a commit on the left to view its diff on the right.

---

## Git Bisect

Bisect performs a binary search through commit history to find the commit that introduced a bug.

### Starting a Bisect

1. Right-click a commit you know is **bad** (has the bug) and select **Bisect (bad)**.
2. A banner appears prompting you to select a **good** commit. Right-click a commit you know is good and select **Bisect (good)**.
3. Git checks out a commit halfway between good and bad.

### Testing Commits

A bisect banner shows at the top of the workspace with buttons:

- **Good** — This commit does not have the bug.
- **Bad** — This commit has the bug.
- **Skip** — Cannot test this commit, skip it.
- **Reset** — Abort the bisect and return to the original branch.

After each mark, Git narrows the range and checks out the next commit to test. When the search completes, the first bad commit is identified.

---

## Remotes Tab

The Remotes tab manages remotes and branches.

### Remotes

- **Add Remote** — Add a new remote by name and URL.
- **Remove Remote** — Delete a remote.
- **Edit URL** — Change the URL of an existing remote.

Each remote shows its fetch URL.

### Branches

Lists all local and remote branches.

- **Checkout** — Switch to a local branch.
- **Checkout Remote** — Create a local tracking branch from a remote branch.
- **New Branch** — Create a new branch from the current HEAD.
- **Rename** — Rename a local branch.
- **Delete** — Delete a local branch.
- **Merge** — Merge a branch into the current branch.
- **Rebase** — Rebase the current branch onto another branch.

### Tags

- **New Tag** — Create a lightweight or annotated tag. Provide a name, optional message (for annotated), and optional target commit.
- **Push Tag** — Push a tag to a remote.
- **Delete Tag** — Delete a tag locally.
- **Delete Remote Tag** — Remove a tag from a remote.

Tags are listed with their name, type (lightweight/annotated), date, and message.

---

## Stashes

Access stash operations from the workspace header **Stash** button, or manage stashes in detail:

- **Stash Push** — Save working directory changes to the stash.
- **Stash Pop** — Apply the most recent stash and remove it.
- **Stash Apply** — Apply a stash without removing it.
- **Stash Drop** — Delete a stash entry.
- **Stash Show** — View the diff of a stash entry.

---

## Merge and Rebase Operations

When a merge or rebase is in progress, a banner appears below the tabs:

### During a Merge

- Resolve conflicts in the Changes tab.
- Stage resolved files.
- Commit to complete the merge.
- **Abort Merge** — Cancel and revert to the pre-merge state.

### During a Rebase

- Resolve conflicts in the Changes tab.
- Stage resolved files.
- **Continue** — Proceed to the next commit in the rebase.
- **Abort Rebase** — Cancel and revert to the pre-rebase state.

---

## Settings

Open settings from the gear icon. Settings are organized into tabs:

### General

- Theme selection (5 built-in themes).
- UI font size adjustment.

### Identities

Manage Git identities (name + email) used for commits.

- Create multiple identities.
- Set a global default identity.
- Override identity per repository.
- Import identity from system Git config.

### Actions

Pre-commit scripts that run before each commit.

- Create, edit, reorder, and delete actions.
- Each action has a name, script (edited in a CodeMirror editor), and enabled/disabled toggle.
- Actions run in order. If any enabled action fails, the commit is blocked.

---

## Peer-to-Peer Features

GitSync includes P2P networking for sharing repositories between machines.

### Peer Discovery

- GitSync discovers peers on the local network automatically.
- Send and accept friend requests to establish trusted connections.
- Block or remove peers.

### Sharing Repositories

- Mark a repository as **shared** to make it available to peers.
- Peers can browse your shared repositories and clone them.
- Cloned peer repos are added as Git remotes using SSH.

### Peer Repos

- Browse repositories shared by connected peers.
- Clone a peer's repository to your local machine.
- Pull and push changes to peer remotes like any other Git remote.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+P` / `Cmd+P` | Quick switch between repositories |
| `Ctrl+Enter` | Commit (when commit message box is focused) |
| `Enter` (in search) | Execute search immediately |

---

## Submodules

GitSync detects and displays Git submodules. Use the **Update Submodules** action to run `git submodule update --init --recursive`.

---

## Troubleshooting

- **Git not found** — GitSync requires Git to be installed and available in your PATH. Install Git and restart the app.
- **Stale file status** — Click the Refresh button in the workspace header to force a status update.
- **Merge conflicts** — Resolve all conflicts before committing. Use "Resolve Ours" or "Resolve Theirs" for quick resolution, or edit files manually.
- **Rebase conflicts** — Resolve conflicts, stage files, then click Continue in the rebase banner. To cancel, click Abort.
- **Push rejected** — Pull first to integrate remote changes, then push again. Force push is available but use with caution.
