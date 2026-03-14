# Developer Guide

This guide covers everything you need to start working on GitSync.

## Prerequisites

- **Node.js** (v18+)
- **Git** installed and on your PATH
- **Go** (only if working on the P2P SSH server in `main/git-server/`)

## Setup

```bash
# Install root dependencies (Electron, better-sqlite3, etc.)
npm install

# Install UI dependencies (Solid.js, Vite, marked)
cd ui && npm install && cd ..
```

## Development Workflow

```bash
npm run dev        # Vite dev server for the UI (hot reload, renderer only)
npm run build      # Build the UI with Vite
npm run start      # Build UI + launch the full Electron app
```

**Typical loop:** Use `npm run dev` while iterating on the frontend — Vite gives instant hot reload. When you need to test IPC handlers, main process changes, or the full app, use `npm run start`.

There is no test runner configured. Verify changes by running the app.

## Project Structure

```
gitsync/
  main.js              # Electron entry point
  preload.js           # IPC bridge (contextBridge)
  main/
    ipc-git.js         # All git IPC handlers
    ipc-p2p.js         # P2P networking handlers
    store.js           # SQLite database
    ksuid.js           # ID generation
    git-server/        # Go SSH server for P2P
  ui/
    src/
      App.jsx          # Root component, signal-based router
      index.jsx        # Entry point, mounts App
      themes.js        # Theme definitions (CSS custom properties)
      styles.css       # Global styles + CSS variable imports
      pages/           # Top-level page components
      panels/          # Workspace tab panels
      components/      # Shared UI components
      context/         # Solid.js context providers
      utils/           # Pure utility functions
      styles/          # CSS files by feature area
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for a detailed breakdown of every module.

## The Three-File IPC Pattern

This is the most important pattern to understand. Every backend operation touches three files:

### 1. Add the handler (`main/ipc-git.js`)

```js
ipcMain.handle('git:myOperation', async (_, repoPath, arg1) => {
  try {
    const out = await git(repoPath, ['some-command', arg1]);
    return { ok: true, output: out.trim() };
  } catch (e) {
    return { error: e.message };
  }
});
```

The `git(repoPath, args)` helper wraps `child_process.execFile` with a 10MB buffer. It rejects on non-zero exit, so always wrap in try/catch and return `{ error }` on failure.

### 2. Expose via preload (`preload.js`)

```js
gitMyOperation: (repoPath, arg1) => ipcRenderer.invoke('git:myOperation', repoPath, arg1),
```

This is pure boilerplate — it forwards arguments to the IPC channel.

### 3. Call from the frontend

```js
const result = await window.api.gitMyOperation(repoPath, arg1);
if (result.error) {
  showAlert('Failed', result.error);
} else {
  // use result
}
```

All `window.api.*` calls return promises. Always check for `result.error`.

## Frontend Patterns

### Solid.js Reactivity

GitSync uses Solid.js (not React). Key differences:

- **Components run once.** The function body executes once; JSX expressions are reactive closures that re-run when their dependencies change. Don't put side effects in the component body.
- **`createSignal`** for primitives, **`createStore`** for objects/arrays.
- **`<For>`** for lists (keyed by index), **`<Show>`** for conditionals.
- **No virtual DOM** — Solid compiles JSX to direct DOM operations.

```jsx
// Correct: reactive access inside JSX
<div>{count()}</div>

// Wrong: this captures the value once
const val = count();
<div>{val}</div>
```

### WorkspaceContext

`context/WorkspaceContext.jsx` is the central state provider for the git workspace. It holds all stores, signals, and operation functions. Components access it via:

```jsx
const ws = useWorkspace();
```

When adding a new feature, add your state and functions here, then expose them in the `ctx` object at the bottom of the provider.

### Adding a New Panel Tab

1. Create `ui/src/panels/MyPanel.jsx`
2. Import it in `pages/GitWorkspace.jsx`
3. Add a tab button in the tabs div
4. Add a `<div class="git-content">` with display toggled by `ws.tab() === 'mytab'`
5. If the tab needs data loaded, add a loader in `WorkspaceContext` and call it from `onTabChange`

### Styling

All styles use CSS custom properties from `themes.js`. Never use hardcoded colors.

```css
/* Correct */
color: var(--text);
background: var(--surface);
border: 1px solid var(--border);

/* Wrong */
color: #ffffff;
background: #1a1a2e;
```

CSS files are in `ui/src/styles/` organized by feature:
- `layout.css` — landing page, buttons, shared layout
- `git-workspace.css` — workspace shell, diff viewer, file tree, section headers
- `git-log.css` — log table, graph, commit detail
- `git-remotes.css` — remotes, branches, tags
- `git-stashes.css` — stash panel

JSX files must use the `.jsx` extension (Vite requirement for Solid.js).

### UI Conventions

- `user-select: none` is set on `.git-workspace` and `.landing`. Re-enable with `user-select: text` on content that should be copyable (diff text, commit messages, hashes).
- Large diffs are capped at 3000 lines with a "click to show more" button (`DiffLines` component in `utils/diff.jsx`).
- Operation output goes to a sidebar log panel, not inline banners. Use `setOutput(msg)` in WorkspaceContext to append.
- Destructive operations (delete branch/tag/stash) must call `showConfirm()` before executing.
- Header action buttons (Stash, Fetch, Pull, Push) are disabled while `operating()` is set.

## SQLite Database

The database lives at `~/.config/gitsync/gitsync.db`. Schema is defined in `main/store.js` via `initDb()`.

To add a table or column:
1. Add the `CREATE TABLE IF NOT EXISTS` or `ALTER TABLE` in `initDb()`
2. Add query functions in `store.js` or inline in `ipc-git.js`

The database uses WAL mode for concurrent read performance.

## Error Handling

- **Backend:** Always return `{ error: e.message }` from IPC handlers, never let exceptions bubble.
- **Frontend:** Check `result.error` or `result?.error` and call `showAlert(title, message)` to display errors.
- **Staging operations:** Check the return value and bail with an alert before calling `refresh()`.

## Building for Distribution

```bash
npm run dist:mac     # macOS DMG
npm run dist:win     # Windows NSIS installer
npm run dist:linux   # Linux AppImage
```

The P2P SSH server binary must be pre-built with Go:

```bash
npm run build:git-server   # builds main/git-server/gitsync-ssh
```

This binary is bundled as an extra resource by electron-builder.

## Common Tasks

### Add a new git operation

Follow the three-file IPC pattern above.

### Add a context menu action

1. Add the handler function in `WorkspaceContext`
2. Add a `<button class="file-context-menu-item">` in `ContextMenu.jsx` or the relevant panel's context menu

### Add a new theme

Edit `ui/src/themes.js` and add an entry to the themes object with all required CSS variable values.

### Debug the main process

Launch with `electron --inspect .` to attach Chrome DevTools to the main process. The renderer DevTools can be opened from the Electron menu (View > Toggle Developer Tools).
