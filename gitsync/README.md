# GitSync

A desktop Git client built with Electron and Solid.js.

## Features

- **Repository management** — organize repos into categories with drag-and-drop, pin favorites
- **Changes view** — stage/unstage files individually or in bulk, inline diff viewer, conflict resolution
- **Commit history** — SVG branch graph visualization, commit details with per-file diffs
- **Branch operations** — create, rename, delete, checkout, merge, rebase, cherry-pick, revert, interactive rebase
- **Remote management** — multiple remotes, push (including new branches), pull with rebase/merge/ff-only strategies, fetch
- **Stash support** — push, pop, apply, drop, diff preview
- **Tags** — create (lightweight or annotated), delete, push to remote
- **Patch export/import** — export staged changes as patches, apply patches from files
- **Git bisect** — interactive good/bad marking to find regressions
- **File history** — per-file commit log with diff at each revision
- **Identity management** — per-repo git author name/email configuration
- **Theming** — 5 built-in themes with CSS custom properties
- **Commit message persistence** — drafts are saved across repo switches and app restarts
- **Keyboard shortcuts** — Ctrl+P repo switcher

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Git](https://git-scm.com/) installed and available in PATH

## Getting Started

```bash
npm install
npm run start      # Build UI + launch Electron app
```

## Development

```bash
npm run dev        # Start Vite dev server (UI only, hot reload)
npm run build      # Build UI with Vite
npm run start      # Build UI + launch Electron app
```

## Distribution

```bash
npm run dist       # Build distributable for current platform
npm run dist:mac   # macOS DMG
npm run dist:win   # Windows NSIS installer
npm run dist:linux # Linux AppImage
```

## Tech Stack

- **Electron** — desktop shell and native OS integration
- **Solid.js** — reactive UI framework
- **Vite** — frontend build tool
- **better-sqlite3** — local database (WAL mode)
- **CodeMirror** — code editor components
- **Font Awesome** — iconography

## Project Structure

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed architecture documentation.

```
main.js              # Electron main process entry
preload.js           # Context bridge (IPC API)
main/
  ipc-git.js         # Git operations + IPC handlers
  store.js           # SQLite database
  ksuid.js           # ID generation
ui/
  src/
    App.jsx           # Root component + routing
    index.jsx         # Entry point
    themes.js         # Theme definitions
    context/          # Solid.js context providers
    pages/            # Top-level page components
    panels/           # Workspace tab panels
    components/       # Shared UI components
    utils/            # Diff parsing, graph, tree, status
    styles/           # CSS stylesheets
```
