# Architecture

## Overview

Conduit is an Electron app with a CommonJS main process and an ESM SolidJS renderer. All renderer-to-main communication goes through Electron's IPC layer via a preload bridge.

```
main.js              Electron entry point
main/                Main process modules (CommonJS)
preload.js           IPC bridge (contextBridge)
ui/                  SolidJS frontend (ESM, built by Vite)
websocket/           Vendored gorilla/websocket (Go, independent)
```

## Main Process

### Entry (`main.js`)

Creates the BrowserWindow, initializes the SQLite database, and registers all IPC handler modules.

### Store (`main/store.js`)

SQLite database (better-sqlite3) that persists all app state: collections, requests, responses, settings, and database connections. Handles schema migrations via `ALTER TABLE`. Data path: `~/.config/api-client/api-client.db`.

### IPC Handlers (`main/ipc-*.js`)

Each module exports a `register(mainWindow)` function called at startup:

| Module               | Responsibility                          |
|----------------------|-----------------------------------------|
| `ipc-collections.js` | Collection and category CRUD            |
| `ipc-requests.js`    | HTTP request execution and responses    |
| `ipc-websocket.js`   | WebSocket and SSE stream management     |
| `ipc-database.js`    | PostgreSQL/SQLite client connections     |
| `ipc-drop.js`        | File drop/transfer server               |
| `ipc-rfc.js`         | RFC index sync, search, and content     |

### Utilities

- `main/ksuid.js` - ID generation (Base62-encoded KSUID)
- `main/import.js` - Collection import (Postman, Insomnia, etc.)

## Preload (`preload.js`)

Bridges main and renderer via `contextBridge.exposeInMainWorld('api', {...})`. The renderer accesses all backend functionality through `window.api.*` calls. Event-driven features (WebSocket messages, SSE events, drop notifications) use `ipcRenderer.on` for main-to-renderer push.

## UI (`ui/`)

SolidJS with JSX, built by Vite. Has its own `package.json` with separate dependencies.

Entry: `ui/index-solid.html` -> `ui/src/index.jsx` -> `ui/src/App.jsx`

### Tab System (`ui/src/store/tabs.jsx`)

Manages tab state via SolidJS `createStore` + context.

| Tab Type     | Page Component       | Description              |
|--------------|----------------------|--------------------------|
| `new`        | `NewTabPage`         | App picker grid          |
| `api`        | `Landing`            | Collection list          |
| `collection` | `Collection`         | HTTP request editor      |
| `db`         | `DatabaseClient`     | DB connection list       |
| `database`   | `DatabaseWorkspace`  | SQL workspace            |
| `rfc`        | `RfcViewer`          | RFC browser/search       |
| `datetime`   | `DateTimeTool`       | Date/time converter      |
| `drop`       | `Drop`               | File transfer            |

Tabs use `display: none` toggling (not conditional rendering) to preserve component state across tab switches. `datetime` and `drop` are singletons. Ctrl/Cmd+W closes tabs; closing the last `new` tab quits the app.

### State Management

- `ui/src/store/collection.jsx` - Collection/request editor state with SolidJS signals. Manages active streams (WebSocket/SSE) with stashing support when switching between requests.
- `ui/src/store/tabs.jsx` - Tab routing and lifecycle.

Both use the `createStore` + `createContext` pattern.

### Key Components

| Component          | Purpose                                  |
|--------------------|------------------------------------------|
| `RequestPane`      | HTTP method, URL, headers, body editor   |
| `ResponsePane`     | Response display (status, headers, body) |
| `ResponseViewer`   | Content-type aware response rendering    |
| `CodeEditor`       | CodeMirror 6 wrapper for request bodies  |
| `SqlEditor`        | CodeMirror 6 wrapper for SQL queries     |
| `Sidebar`          | Collection/category tree navigation      |
| `CategoryList`     | Drag-and-drop category management        |
| `ResultsTable`     | Database query result grid               |
| `NewTabPage`       | App picker (API, Database, RFC)          |
| `Variables`        | Environment variable management          |
| `Modal`/`FormModal`| Dialog components                        |

### Styling

Single CSS file at `ui/src/styles.css` with CSS custom properties for theming. Theme definitions in `ui/src/themes.js`.

## WebSocket/SSE Stream Stashing

Collections support one active stream per collection. When the user switches to a different request while a WS/SSE stream is open, the stream state is stashed and restored on navigation back. Event handlers check both active and stashed connections. On disconnect, stream history is persisted to the responses table.

## IPC Communication Pattern

```
Renderer (SolidJS)
    |
    |  window.api.* calls
    v
Preload (contextBridge)
    |
    |  ipcRenderer.invoke / ipcRenderer.on
    v
Main Process (ipcMain.handle)
    |
    |  better-sqlite3 / pg / ws / net
    v
External Systems (filesystem, databases, network)
```

- **Request/Response**: `ipcRenderer.invoke` / `ipcMain.handle` for all CRUD and queries
- **Push Events**: `ipcRenderer.on` for WebSocket messages, SSE events, sync progress, and drop notifications
