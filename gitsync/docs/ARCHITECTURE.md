# Architecture

## Overview

GitSync is an Electron desktop application with a Solid.js frontend for managing git repositories. It follows Electron's standard process model with IPC communication between the main process and renderer.

```
┌─────────────────────────────────────────────────────┐
│                   Electron Shell                     │
│                                                      │
│  ┌──────────────┐    IPC     ┌────────────────────┐ │
│  │ Main Process │◄──────────►│    Renderer        │ │
│  │              │  (preload)  │                    │ │
│  │  ipc-git.js  │            │  Solid.js SPA      │ │
│  │  ipc-p2p.js  │            │  (Vite-built)      │ │
│  │  store.js    │            │                    │ │
│  └──────┬───────┘            └────────────────────┘ │
│         │                                            │
│         ▼                                            │
│  ┌──────────────┐  ┌──────────────┐                 │
│  │   SQLite DB  │  │ git CLI      │                 │
│  │  (gitsync.db)│  │ (execFile)   │                 │
│  └──────────────┘  └──────────────┘                 │
└─────────────────────────────────────────────────────┘
```

## Process Model

### Main Process (`main.js`)

Entry point for Electron. Creates the BrowserWindow, checks for git availability on startup, and registers all IPC handlers from `ipc-git.js` and `ipc-p2p.js`.

### Preload (`preload.js`)

Uses `contextBridge.exposeInMainWorld('api', {...})` to expose IPC methods to the renderer as `window.api.*`. Every backend operation is accessible through this bridge. This is the single surface between the two processes.

### Renderer (`ui/`)

Solid.js single-page application built with Vite. All git operations go through `window.api.*` calls — the renderer never accesses Node.js or the filesystem directly.

## Backend (`main/`)

### `ipc-git.js`

All git operations are performed via `child_process.execFile` through a helper function `git(repoPath, args)` that wraps calls with a 10MB output buffer. This file contains IPC handlers for:

- **Repository CRUD** — list, add, remove, rename repos and categories
- **Status & diff** — working tree status, staged/unstaged/untracked diffs, conflict diffs
- **Staging** — stage, unstage, stage all, discard changes
- **Commits** — commit, amend, log (with pagination), show, cherry-pick, revert, drop
- **Branches** — list, create, checkout, rename, delete, checkout remote
- **Remotes** — list, add, remove, set URL
- **Pull/Push/Fetch** — with divergent history detection, force push (`--force-with-lease`), set upstream (`-u`)
- **Merge & Rebase** — merge, rebase, continue, abort, interactive rebase
- **Stash** — push, pop, apply, drop, show
- **Tags** — list, create (lightweight/annotated), delete, push to remote
- **Patch** — export staged changes, apply patches
- **Bisect** — start, mark good/bad, reset
- **Conflict resolution** — checkout ours/theirs + stage
- **File history** — per-file log and diff at specific commits
- **Submodules** — list, init/update
- **Identity** — per-repo git author name/email via git config
- **Filesystem watching** — `fs.watch` on `.git` directory with debounced change notifications

### `ipc-p2p.js`

Peer-to-peer repository sharing over the local network:

- **mDNS discovery** — uses `@homebridge/ciao` to advertise and discover peers
- **SSH git server** — bundled Go binary (`main/git-server/`) that serves git repos over SSH
- **Pull requests** — lightweight PR system between peers

### `store.js`

SQLite database at `~/.config/gitsync/gitsync.db` using better-sqlite3 with WAL mode. Tables:

| Table | Purpose |
|-------|---------|
| `settings` | Key-value app settings |
| `git_repos` | Repository paths, names, categories, pinned state |
| `git_categories` | Repo organization categories with sort order |
| `git_identities` | Git author name/email profiles |
| `p2p_peers` | Discovered network peers |
| `p2p_shared_repos` | Repos shared via P2P |
| `p2p_peer_repos` | Repos available on remote peers |
| `p2p_pull_requests` | P2P pull request records |

### `ksuid.js`

Generates timestamp-sortable unique IDs (base62, 27 characters). Used as primary keys for all database records.

### `git-server/` (Go)

A Go binary that provides an SSH server for P2P git operations. Handles `git-upload-pack` and `git-receive-pack` over SSH connections between peers.

## Frontend (`ui/src/`)

### Routing

`App.jsx` uses a simple signal-based router. Page types: `landing` (repo list), `git` (workspace), `peers`, `peer-repos`. Switching repos destroys and recreates the WorkspaceProvider to ensure clean state.

### State Management

Solid.js stores (`createStore`) for complex objects, signals (`createSignal`) for primitives. State is shared via context providers.

#### `context/WorkspaceContext.jsx`

Central provider for all git workspace state and operations. Components access it via `useWorkspace()`. Manages:

- **Status store** — branch, upstream, ahead/behind counts, file list
- **Diff store** — current diff content, filepath, staged flag
- **Commit store** — message, description, amend state (persisted to localStorage)
- **Log store** — commit list, graph data, pagination
- **Remotes/branches/tags/stashes stores**
- **Operations** — staging, committing, pulling, pushing, fetching, merging, rebasing, stashing, etc.
- **UI state** — expanded dirs, collapsed sections, context menus, tab selection

### Pages

| File | Purpose |
|------|---------|
| `GitClient.jsx` | Landing page: repo list with categories, drag-drop organization, search |
| `GitWorkspace.jsx` | Workspace shell: header bar, tab navigation, panel routing, merge/rebase banners |
| `PeersPage.jsx` | P2P peer discovery and management |
| `PeerReposPage.jsx` | Browse repos available on a specific peer |
| `PullRequestsPage.jsx` | P2P pull request list and management |

### Panels (workspace tabs)

| File | Purpose |
|------|---------|
| `ChangesPanel.jsx` | Conflicts section, staged/unstaged/untracked file trees, diff viewer, commit box |
| `LogPanel.jsx` | Commit history with SVG graph, commit detail with per-file diffs |
| `RemotesPanel.jsx` | Remote URLs, local branches (push/merge/rebase/rename/delete), remote branches (checkout), tags |
| `StashesPanel.jsx` | Stash list with pop/apply/drop, diff preview |

### Components

| File | Purpose |
|------|---------|
| `FileTree.jsx` | Hierarchical file display with section-scoped folder expansion |
| `ContextMenu.jsx` | Right-click context menus for files and folders |
| `RepoSwitcher.jsx` | Ctrl+P fuzzy repo switcher overlay |
| `Modal.jsx` | Alert/confirm/prompt/choice dialogs + tabbed settings (General, Identities, P2P) |
| `InteractiveRebase.jsx` | Interactive rebase editor (pick/reword/edit/squash/fixup/drop) |
| `FileHistory.jsx` | Per-file commit history with diff viewer |
| `FormModal.jsx` | Reusable form modal component |
| `ResizeHandle.jsx` | Draggable panel resize handle |
| `CategoryList.jsx` | Category management for repo organization |
| `ItemCard.jsx` | Repo/category card component |
| `Icon.jsx` | Font Awesome icon wrapper |

### Utilities

| File | Purpose |
|------|---------|
| `utils/graph.jsx` | Commit graph algorithm with stable first-parent lane tracking + `GraphCell` SVG component |
| `utils/diff.jsx` | Diff parsing (`parseDiffLines`, `parseDiffFiles`) + `DiffLine` and `DiffContent` components |
| `utils/tree.js` | File tree building and path compacting |
| `utils/status.js` | File status categorization including conflict detection (`UU`, `AA`, `DD`, etc.) |
| `utils/path.js` | Shared `shortenPath` utility |

## IPC Pattern

Adding a new git operation requires changes in three places:

1. **`main/ipc-git.js`** — add `ipcMain.handle('git:operationName', ...)` handler
2. **`preload.js`** — add `gitOperationName: (...) => ipcRenderer.invoke('git:operationName', ...)` bridge
3. **Frontend** — call via `window.api.gitOperationName(...)`

## Key Behaviors

- **File status reconciliation** — `refresh()` in WorkspaceContext uses Solid's `reconcile` with `key: 'path'` to ensure stale file entries are properly removed when states change.
- **Folder expansion** — directory toggle keys are section-scoped (`section:dirPath`) so the same folder in staged/unstaged/untracked sections expands independently.
- **Batch operations** — staging/unstaging folders and context menu operations batch all file paths into a single git command to avoid race conditions from multiple rapid refreshes.
- **Conflict resolution** — files with conflict status codes (`UU`, `AA`, `DD`, `AU`, `UA`, `DU`, `UD`) are filtered into a dedicated Conflicts section. Resolved with `git checkout --ours/--theirs` + `git add`.
- **Git log** — uses `--topo-order` and `--exclude=refs/stash` to keep topological ordering stable for the graph and prevent stash refs from appearing.
- **Commit message persistence** — draft commit messages are saved to localStorage (keyed by repo path) when switching repos or closing the app, and restored on re-open.
- **Filesystem watching** — the main process watches each open repo's `.git` directory and sends change notifications to the renderer for automatic refresh.

## Theming

`ui/src/themes.js` defines 5 themes using CSS custom properties:

| Variable | Purpose |
|----------|---------|
| `--bg` | Page background |
| `--surface` | Card/panel background |
| `--surface2` | Elevated surface |
| `--border` | Border color |
| `--text` | Primary text |
| `--text-dim` | Secondary/muted text |
| `--accent` | Accent/link color |
| `--danger` | Destructive action color |
| `--success` | Success/added color |
| `--warning` | Warning color |

All styles use these variables — never hardcoded colors.

## Data Storage

- **SQLite database** — `~/.config/gitsync/gitsync.db` for repos, categories, identities, P2P state
- **localStorage** — draft commit messages (per repo path), UI preferences
- **Git CLI** — all repository operations delegate to the system `git` binary
