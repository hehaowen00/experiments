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

- `ipc-git.js` — Thin orchestrator that defines `git()` and `gitRaw()` helpers and delegates to `main/git/` modules.
- `main/git/` — Modular IPC handlers split by domain: `repos.js`, `categories.js`, `identities.js`, `dialogs.js`, `status.js`, `staging.js`, `commit.js`, `log.js`, `sync.js`, `remotes.js`, `branches.js`, `merge-rebase.js`, `tags.js`, `stash.js`, `submodules.js`, `worktrees.js`, `patches.js`, `conflicts.js`, `bisect.js`, `watcher.js`. Each exports `register({ mainWindow, git, gitRaw })`.
- `ipc-p2p.js` — P2P networking IPC handlers (LAN discovery, SSH server, friend requests).
- `store.js` — SQLite database (`~/.config/gitsync/gitsync.db`) with tables: `settings`, `git_repos`, `git_categories`, `git_identities`. Uses better-sqlite3 with WAL mode.
- `ksuid.js` — Timestamp-sortable unique ID generation (base62, 27 chars).

### Frontend (`ui/src/`)

**State management:** Solid.js stores and signals, shared via context.

- `context/WorkspaceContext.jsx` — Central provider that declares stores/signals and composes operation modules from `context/ops/`. Components call `useWorkspace()` to access state/actions.
- `context/ops/` — Modular operation creators split by domain: `staging.js`, `diff.js`, `commit.js`, `sync.js`, `branches.js`, `merge-rebase.js`, `log.js`, `remotes.js`, `tags.js`, `stash.js`, `worktrees.js`, `hunk.js`, `discard.js`, `conflicts.js`, `file-history.js`, `bisect.js`, `patches.js`. Each exports a `create*Ops(deps)` function that receives stores/signals and returns an object of functions.
- `pages/GitClient.jsx` — Landing page: repo list, categories, drag-drop organization.
- `pages/GitWorkspace.jsx` — Slim orchestrator wrapping `WorkspaceProvider` with header, tabs, panel routing, and merge/rebase operation banners.

**Panels** (tab content within GitWorkspace):
- `panels/ChangesPanel.jsx` — Conflicts section, staged/unstaged/untracked files, diff viewer, commit box
- `panels/LogPanel.jsx` — Commit history with SVG graph visualization
- `panels/StashesPanel.jsx` — Stash management with file tree and lazy-loaded per-file diffs
- `panels/RemotesPanel.jsx` — Remote and branch management (checkout, merge, rebase)

**Shared UI library** (`ui/src/lib/`):
- `Icon.jsx`, `Select.jsx`, `FormModal.jsx`, `ItemCard.jsx`, `CategoryList.jsx`, `ResizeHandle.jsx`
- `index.js` — barrel export for all shared components
- Import via `../lib/Icon` or `../lib` (barrel)

**Domain components** (`ui/src/components/`):
- `Modal.jsx` — Re-exports from `modal/state.js` (show* functions) and `modal/ModalDialog.jsx` (UI)
- `modal/state.js` — Modal signal state and exported `showPrompt`, `showConfirm`, `showAlert`, etc.
- `modal/ModalDialog.jsx` — Modal overlay/dialog rendering
- `settings/GeneralTab.jsx`, `settings/IdentitiesTab.jsx`, `settings/P2PTab.jsx` — Settings panel tabs
- `FileTree.jsx`, `ContextMenu.jsx`, `RepoSwitcher.jsx`, `FileHistory.jsx`, `InteractiveRebase.jsx`, `Titlebar.jsx`

**Utilities:** `utils/graph.jsx` (commit graph algorithm with stable first-parent lane tracking + GraphCell SVG), `utils/diff.jsx` (diff parsing + DiffLine component), `utils/tree.js` (file tree building/compacting), `utils/status.js` (file categorization including conflict detection), `utils/path.js` (shared shortenPath).

### IPC Pattern

Adding a new git operation requires changes in three places:
1. `main/git/<domain>.js` — `ipcMain.handle('git:operationName', ...)` handler in the appropriate module
2. `preload.js` — `gitOperationName: (...) => ipcRenderer.invoke('git:operationName', ...)`
3. Frontend — call via `window.api.gitOperationName(...)`

### Adding a new workspace operation

1. Create or add to the appropriate `context/ops/<domain>.js` module
2. Follow the `create*Ops(deps)` pattern — receive stores/signals, return functions
3. Wire it up in `WorkspaceContext.jsx` by calling the creator and spreading the result into `ctx`

### Key Behaviors

- **File status reconciliation:** `refresh()` in WorkspaceContext uses `reconcile` with `key: 'path'` on the files array to ensure stale entries are properly removed when file states change.
- **Folder expansion:** Directory toggle keys are section-scoped (`section:dirPath`) so the same folder in different sections (staged/unstaged/untracked) expands independently.
- **Batch operations:** Staging/unstaging folders and context menu operations batch all file paths into a single git command to avoid race conditions from multiple rapid refreshes.
- **Conflict resolution:** Files with conflict status (`UU`, `AA`, `DD`, `AU`, `UA`, `DU`, `UD`) are filtered into a dedicated Conflicts section. Resolve with `git checkout --ours/--theirs` + `git add`.
- **Git log:** Uses `--topo-order` and `--exclude=refs/stash` to prevent stash refs from appearing and to keep topological ordering stable for the graph.
- **Lazy diff loading:** Commit detail and stash detail fetch only metadata + `--numstat` file lists upfront. Individual file diffs are loaded on demand via `git:showFileDiff` / `git:stashShowFileDiff` when the user expands a file. This prevents `maxBuffer` errors on commits with large diffs. The `git()` helper has a 10MB `maxBuffer` — avoid fetching unbounded diff output in a single call.

### Theming

`ui/src/themes.js` defines 5 themes using CSS custom properties (`--bg`, `--surface`, `--surface2`, `--border`, `--text`, `--text-dim`, `--accent`, `--danger`, `--success`, `--warning`). Always use these variables, not hardcoded colors.

## Code Style

- Prettier configured: single quotes, trailing commas, 80 char width
- JSX files must use `.jsx` extension (Vite requirement for Solid.js)
- No TypeScript — plain JS throughout
- Solid.js reactivity: use `createStore` for objects, `createSignal` for primitives, `<For>` for lists, `<Show>` for conditionals
