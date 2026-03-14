# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm run dev        # Start Vite dev server (UI only, hot reload)
npm run build      # Build UI with Vite
npm run start      # Build UI + launch Electron app
npm run dist       # Build distributable (electron-builder)
npm run dist:mac   # macOS DMG
npm run dist:win   # Windows NSIS installer
npm run dist:linux # Linux AppImage
```

No test runner is configured.

## Architecture

**Electron desktop app** with Solid.js frontend for managing git repositories.

### Process Model

- **Main process** (`main.js`) — Electron BrowserWindow, registers IPC handlers. Checks for git on startup and prompts install if missing.
- **Preload** (`preload.js`) — `contextBridge.exposeInMainWorld('api', {...})` exposes IPC methods to the renderer as `window.api.*`
- **Renderer** (`ui/`) — Solid.js SPA built with Vite

### Backend (`main/`)

- `ipc-git.js` — All git operations via `child_process.execFile`. Helper `git(repoPath, args)` wraps calls with 10MB buffer. Also handles repo/category CRUD, identity management, conflict resolution, and patch import/export against SQLite.
- `store.js` — SQLite database (`~/.config/gitsync/gitsync.db`) with tables: `settings`, `git_repos`, `git_categories`, `git_identities`. Uses better-sqlite3 with WAL mode.
- `ksuid.js` — Timestamp-sortable unique ID generation (base62, 27 chars).

### Frontend (`ui/src/`)

**State management:** Solid.js stores and signals, shared via context.

- `context/WorkspaceContext.jsx` — Central provider for all git workspace state and operations. Components call `useWorkspace()` to access state/actions. Handles staging, committing, pulling, pushing, conflict resolution, patch export, and more.
- `pages/GitClient.jsx` — Landing page: repo list, categories, drag-drop organization.
- `pages/GitWorkspace.jsx` — Slim orchestrator wrapping `WorkspaceProvider` with header, tabs, panel routing, and merge/rebase operation banners.

**Panels** (tab content within GitWorkspace):
- `panels/ChangesPanel.jsx` — Conflicts section, staged/unstaged/untracked files, diff viewer, commit box
- `panels/LogPanel.jsx` — Commit history with SVG graph visualization
- `panels/RemotesPanel.jsx` — Remote and branch management (checkout, merge, rebase)

**Shared components:** `FileTree.jsx` (hierarchical file display with section-scoped folder expansion), `ContextMenu.jsx`, `RepoSwitcher.jsx` (Ctrl+P), `Modal.jsx` (alert/confirm/prompt/tabbed settings with General/Identities/P2P tabs).

**Utilities:** `utils/graph.jsx` (commit graph algorithm with stable first-parent lane tracking + GraphCell SVG), `utils/diff.jsx` (diff parsing + DiffLine component), `utils/tree.js` (file tree building/compacting), `utils/status.js` (file categorization including conflict detection), `utils/path.js` (shared shortenPath).

### IPC Pattern

Adding a new git operation requires changes in three places:
1. `main/ipc-git.js` — `ipcMain.handle('git:operationName', ...)` handler
2. `preload.js` — `gitOperationName: (...) => ipcRenderer.invoke('git:operationName', ...)`
3. Frontend — call via `window.api.gitOperationName(...)`

### Key Behaviors

- **File status reconciliation:** `refresh()` in WorkspaceContext uses `reconcile` with `key: 'path'` on the files array to ensure stale entries are properly removed when file states change.
- **Folder expansion:** Directory toggle keys are section-scoped (`section:dirPath`) so the same folder in different sections (staged/unstaged/untracked) expands independently.
- **Batch operations:** Staging/unstaging folders and context menu operations batch all file paths into a single git command to avoid race conditions from multiple rapid refreshes.
- **Conflict resolution:** Files with conflict status (`UU`, `AA`, `DD`, `AU`, `UA`, `DU`, `UD`) are filtered into a dedicated Conflicts section. Resolve with `git checkout --ours/--theirs` + `git add`.
- **Git log:** Uses `--topo-order` and `--exclude=refs/stash` to prevent stash refs from appearing and to keep topological ordering stable for the graph.

### Theming

`ui/src/themes.js` defines 5 themes using CSS custom properties (`--bg`, `--surface`, `--surface2`, `--border`, `--text`, `--text-dim`, `--accent`, `--danger`, `--success`, `--warning`). Always use these variables, not hardcoded colors.

## Code Style

- Prettier configured: single quotes, trailing commas, 80 char width
- JSX files must use `.jsx` extension (Vite requirement for Solid.js)
- No TypeScript — plain JS throughout
- Solid.js reactivity: use `createStore` for objects, `createSignal` for primitives, `<For>` for lists, `<Show>` for conditionals
