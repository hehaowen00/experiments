# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Conduit

Conduit is an Electron desktop app (similar to Postman/Insomnia) for API development. It supports HTTP request collections, WebSocket connections, SSE streams, a database client (PostgreSQL and SQLite), and file drop/transfer.

## Commands

```bash
# Development - run UI dev server (hot reload, no Electron shell)
cd ui && npx vite

# Development - build UI and launch Electron
npm start

# Build UI only
npm run build

# Package for distribution
npm run dist          # all platforms
npm run dist:mac      # macOS .dmg
npm run dist:win      # Windows .nsis
npm run dist:linux    # Linux .AppImage
```

There are no tests or linting configured for the JS/Electron portion.

The `websocket/` directory is a vendored copy of gorilla/websocket (Go) and is independent from the Electron app. Run Go tests with `cd websocket && go test ./...`.

## Architecture

### Electron Main Process (`main.js`, `main/`)
- **CommonJS modules** throughout (`require`/`module.exports`)
- `main.js` — App entry point; creates BrowserWindow, initializes SQLite DB, registers IPC handlers
- `main/store.js` — SQLite database (better-sqlite3) for app state: collections, responses, settings, DB connections. Handles schema migrations via ALTER TABLE. Data stored at `~/.config/api-client/api-client.db`
- `main/ipc-*.js` — IPC handler modules, each exports a `register(mainWindow)` function called at startup. Handles: collections, HTTP requests, WebSocket, database client, file drop
- `main/ksuid.js` — ID generation

### Preload (`preload.js`)
- Bridges main↔renderer via `contextBridge.exposeInMainWorld('api', {...})`. The renderer accesses all backend functionality through `window.api.*` calls.

### UI (`ui/`)
- **SolidJS** with JSX, built by Vite (`vite-plugin-solid`)
- Entry: `ui/index-solid.html` → `ui/src/index.jsx` → `ui/src/App.jsx`
- Has its own `package.json` with separate dependencies (codemirror, solid-js)
- Simple signal-based routing in App.jsx: `landing` | `collection` | `database`

**Pages:** Landing (home/sidebar), Collection (HTTP request editor), DatabaseWorkspace/DatabaseClient (SQL client), Drop (file transfer), DateTimeTool

**Key components:** RequestPane/ResponsePane (HTTP), CodeEditor/SqlEditor (CodeMirror wrappers), Sidebar, CategoryList, ResultsTable

**State:** `ui/src/store/collection.jsx` manages collection state with SolidJS signals

### IPC Communication Pattern
All renderer→main communication uses Electron's `ipcRenderer.invoke` / `ipcMain.handle` pattern. Event-driven features (WebSocket messages, SSE events, drop notifications) use `ipcRenderer.on` for main→renderer push.
