# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Conduit

Conduit is split into three Electron desktop apps sharing a monorepo:

- **API Client** (`apps/api-client/`) — HTTP collections, WebSocket, SSE
- **DB Client** (`apps/db-client/`) — PostgreSQL + SQLite workspace
- **Toolbox** (`apps/toolbox/`) — RFC viewer, date/time converter, file drop

Shared code lives in `packages/` — UI library (`@conduit/ui-shared`) and main-process core (`@conduit/core`). Each app owns its own SQLite DB under `~/.config/conduit-{api,db,toolbox}/`.

## Commands

```bash
# Install (workspaces)
npm install

# Dev (Vite hot reload, no Electron)
npm run dev:api
npm run dev:db
npm run dev:toolbox

# Build UI + launch Electron
npm run start:api
npm run start:db
npm run start:toolbox

# Package a specific app
npm run dist:mac --workspace=@conduit/api-client
npm run dist:win --workspace=@conduit/db-client
npm run dist:linux --workspace=@conduit/toolbox

# Build or package all apps
npm run build
npm run dist
```

No tests or linting are configured for the JS/Electron portion.

The `websocket/` directory is a vendored copy of gorilla/websocket (Go), independent of the Electron apps. Run Go tests with `cd websocket && go test ./...`.

## Repo layout

```
conduit/
├── apps/
│   ├── api-client/      # HTTP/WS/SSE app
│   │   ├── main.js, preload.js
│   │   ├── main/        # store.js, ipc-collections, ipc-requests, ipc-websocket, import.js
│   │   └── ui/          # Vite + SolidJS UI
│   ├── db-client/       # Database app
│   │   ├── main.js, preload.js
│   │   ├── main/        # store.js, ipc-database
│   │   └── ui/
│   └── toolbox/         # RFC + datetime + drop
│       ├── main.js, preload.js
│       ├── main/        # store.js (with rfc.db), ipc-rfc, ipc-drop
│       └── ui/          # has two Vite entries: index.html + drop.html
├── packages/
│   ├── core/            # CommonJS: ksuid, store-pragmas
│   └── ui-shared/       # ESM: themes, locale, Modal/Select/Icon/FormModal/ItemCard/
│                        # CategoryList/TitleBar/TabBar, TabProvider tab store, fonts helpers
├── package.json         # npm workspaces root
└── websocket/           # vendored Go (independent)
```

## Architecture

### Main process (per app)
- **CommonJS** (`require`/`module.exports`). Each app has its own `main.js`, `preload.js`, and `main/` folder.
- `main/store.js` — app-specific SQLite schema and queries. Each app uses `@conduit/core`'s `applyPragmas` and may use `generateKSUID` for IDs.
- `main/ipc-*.js` — IPC handler modules, each exports `register(mainWindow)` called at startup.

### DB paths
- api-client: `~/.config/conduit-api/app.db` (collections, responses, categories, settings)
- db-client: `~/.config/conduit-db/app.db` (db_connections, db_categories, settings)
- toolbox: `~/.config/conduit-toolbox/app.db` (settings) + `~/.config/conduit-toolbox/rfc.db` (rfcs, rfc_content, rfc_meta)

On first launch, each app does a one-time migration from the legacy `~/.config/api-client/api-client.db` (and the toolbox also pulls in `~/.config/api-client/rfc.db`).

### Preload
Each app's `preload.js` exposes only the IPC surface relevant to that app via `contextBridge.exposeInMainWorld('api', {...})`. Shared: window controls, `getAllSettings`/`setSetting`, `openExternal`, `saveFile`, `homeDir`.

### UI (per app)
- **SolidJS + Vite**. Each `apps/*/ui/` has its own `package.json` and `vite.config.js`.
- Entry: `apps/<app>/ui/index.html` → `src/index.jsx` → `src/App.jsx`.
- The shared UI library `@conduit/ui-shared` is resolved via a Vite alias (`packages/ui-shared`). `vite-plugin-solid` is configured to process JSX in that path.
- Shared components: `Icon`, `Modal` (+ settings + `showPrompt/showConfirm/showTextarea/showAlert`), `Select`, `FormModal`/`FormField`, `ItemCard`, `CategoryList`, `TitleBar`, `TabBar`.
- Shared stores: `TabProvider` (generic — accepts `tabTypes`, `pinnedTools`, `initialType` props), `useTabs`.
- Shared helpers: `applyTheme`, `applyUiFontSize`, `applyEditorFontSize`, `t` (locale).

### Tabs
- api-client uses `TabProvider` with tab types `api | collection` (initialType: `api`). New tabs open to Landing; closing the last quits.
- db-client uses `TabProvider` with tab types `db | database` (initialType: `db`). Same closing behavior.
- toolbox doesn't use tabs — it has a single shell with a top-nav switching between RFC / DateTime / Drop. State is preserved via `display: none` toggling.

### WebSocket/SSE stream stashing
Lives in `apps/api-client/ui/src/store/collection.jsx`. When a user switches requests while a WS/SSE stream is open, the stream state is "stashed" and restored on return. On disconnect, history is persisted via `saveWsHistory()`. `saveResponse` wipes previous response data for the same `request_id` so only the latest retains full body/messages.

### Styles
Each app currently ships a full copy of the legacy `styles.css` (4466 lines, with clear feature-section comments). The `packages/ui-shared/fonts.js` exports the CSS variable helpers used by the settings modal. Further style deduplication is a future cleanup.

## Key conventions
- Main process = CommonJS; UI = ESM. Do not mix.
- SolidJS reactivity: use `<Switch>`/`<Match>` (not JS `switch`) when rendering needs to react to store property changes inside `<For>`.
- Prettier: 80 char width, single quotes, trailing commas (`.prettierrc`).
- When adding a new shared component, add it to `packages/ui-shared/components/` and re-export it from `packages/ui-shared/index.js`.
