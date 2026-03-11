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

- **Main process** (`main.js`) — Electron BrowserWindow, registers IPC handlers
- **Preload** (`preload.js`) — `contextBridge.exposeInMainWorld('api', {...})` exposes ~60 IPC methods to the renderer as `window.api.*`
- **Renderer** (`ui/`) — Solid.js SPA built with Vite

### Backend (`main/`)

- `ipc-git.js` — All git operations via `child_process.execFile`. Helper `git(repoPath, args)` wraps calls with 10MB buffer. Also handles repo/category CRUD against SQLite. Untracked file listing uses `git ls-files --others --exclude-standard`.
- `store.js` — SQLite database (`~/.config/gitsync/gitsync.db`) with tables: `settings`, `git_repos`, `git_categories`. Uses better-sqlite3 with WAL mode.
- `ksuid.js` — Timestamp-sortable unique ID generation (base62, 27 chars).

### Frontend (`ui/src/`)

**State management:** Solid.js stores and signals, shared via context.

- `context/WorkspaceContext.jsx` — Central provider for all git workspace state and operations. Components call `useWorkspace()` to access state/actions.
- `pages/GitClient.jsx` — Landing page: repo list, categories, drag-drop organization.
- `pages/GitWorkspace.jsx` — Slim orchestrator wrapping `WorkspaceProvider` with header, tabs, and panel routing.

**Panels** (tab content within GitWorkspace):
- `panels/ChangesPanel.jsx` — Staged/unstaged/untracked files, diff viewer, commit box
- `panels/LogPanel.jsx` — Commit history with SVG graph visualization
- `panels/RemotesPanel.jsx` — Remote and branch management (checkout, merge, rebase)
- `panels/StashesPanel.jsx` — Stash list with push/pop/apply/drop

**Shared components:** `FileTree.jsx` (hierarchical file display), `ContextMenu.jsx`, `RepoSwitcher.jsx` (Ctrl+P), `Modal.jsx` (alert/confirm/prompt/settings).

**Utilities:** `utils/graph.jsx` (commit graph algorithm + GraphCell SVG), `utils/diff.jsx` (diff parsing + DiffLine component), `utils/tree.js` (file tree building/compacting), `utils/status.js` (file categorization), `utils/path.js` (shared shortenPath).

### IPC Pattern

Adding a new git operation requires changes in three places:
1. `main/ipc-git.js` — `ipcMain.handle('git:operationName', ...)` handler
2. `preload.js` — `gitOperationName: (...) => ipcRenderer.invoke('git:operationName', ...)`
3. Frontend — call via `window.api.gitOperationName(...)`

### Theming

`ui/src/themes.js` defines 5 themes using CSS custom properties (`--bg`, `--surface`, `--surface2`, `--border`, `--text`, `--text-dim`, `--accent`, `--danger`, `--success`, `--warning`). Always use these variables, not hardcoded colors.

## Code Style

- Prettier configured: single quotes, trailing commas, 80 char width
- JSX files must use `.jsx` extension (Vite requirement for Solid.js)
- No TypeScript — plain JS throughout
- Solid.js reactivity: use `createStore` for objects, `createSignal` for primitives, `<For>` for lists, `<Show>` for conditionals
