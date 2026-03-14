# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Conduit

Conduit is an Electron desktop app (similar to Postman/Insomnia) for API development. It supports HTTP request collections, WebSocket connections, SSE streams, a database client (PostgreSQL and SQLite), an RFC viewer/downloader, a date/time converter, and file drop/transfer.

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
- `main/ipc-*.js` — IPC handler modules, each exports a `register(mainWindow)` function called at startup. Handles: collections, HTTP requests, WebSocket, database client, file drop, RFC viewer
- `main/ksuid.js` — ID generation (Base62-encoded KSUID)

### Preload (`preload.js`)
- Bridges main↔renderer via `contextBridge.exposeInMainWorld('api', {...})`. The renderer accesses all backend functionality through `window.api.*` calls.

### UI (`ui/`)
- **SolidJS** with JSX, built by Vite (`vite-plugin-solid`)
- Entry: `ui/index-solid.html` → `ui/src/index.jsx` → `ui/src/App.jsx`
- Has its own `package.json` with separate dependencies (codemirror, solid-js)

**Tab system:** `ui/src/store/tabs.jsx` manages tab state via SolidJS `createStore` + context. Tab types: `new` (app picker), `api` (collection list), `collection` (HTTP editor), `db` (DB connection list), `database` (SQL workspace), `rfc` (RFC viewer), `datetime`, `drop`. Tabs use `display: none` toggling (not conditional rendering) to preserve component state across tab switches. `datetime` and `drop` are singletons (one instance max). Ctrl/Cmd+W closes tabs; closing the last new tab quits the app.

**Pages:** Landing (collection list), Collection (HTTP request editor), DatabaseClient (connection list), DatabaseWorkspace (SQL client), RfcViewer (RFC browser/search), DateTimeTool, Drop (file transfer)

**Key components:** RequestPane/ResponsePane (HTTP), CodeEditor/SqlEditor (CodeMirror 6 wrappers), Sidebar, CategoryList, ResultsTable, NewTabPage (app picker grid)

**State:** `ui/src/store/collection.jsx` manages collection/request editor state with SolidJS signals. `ui/src/store/tabs.jsx` manages tab routing. Both use `createStore` + `createContext` pattern.

### IPC Communication Pattern
All renderer→main communication uses Electron's `ipcRenderer.invoke` / `ipcMain.handle` pattern. Event-driven features (WebSocket messages, SSE events, drop notifications) use `ipcRenderer.on` for main→renderer push.

### WebSocket/SSE Stream Stashing
`collection.jsx` supports one active stream per collection. When the user switches to a different request while a WS/SSE stream is open, the stream state is "stashed" (saved to a `stashedStream` variable) and restored if the user navigates back. Event handlers (`onWsMessage`, `onWsClose`, etc.) check both the active connection and the stashed connection. On disconnect or close, stream history (including messages) is persisted to the responses table via `saveWsHistory()`. The `saveResponse` DB function wipes previous response data for the same `request_id` before inserting, so only the latest response retains full body/messages.

### Key Conventions
- Main process uses CommonJS; UI uses ESM. Do not mix.
- SolidJS reactivity: use `<Switch>`/`<Match>` (not JS `switch`) when rendering needs to react to store property changes inside `<For>`.
- Prettier: 80 char width, single quotes, trailing commas (`.prettierrc`).
