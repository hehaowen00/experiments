# Conduit

A desktop API development tool built with Electron and SolidJS. Similar to Postman/Insomnia, with additional built-in utilities.

## Features

- **API Client** - HTTP request collections with support for multiple methods, headers, body types, and response viewing
- **WebSocket & SSE** - Real-time WebSocket connections and Server-Sent Events streaming
- **Database Client** - Connect to PostgreSQL and SQLite databases, browse schemas, and run SQL queries
- **RFC Viewer** - Browse, search, and read IETF RFCs with offline indexing
- **Date/Time Tool** - Date and time format converter
- **Drop** - File drop and transfer utility

## Getting Started

### Prerequisites

- Node.js
- npm

### Install Dependencies

```bash
npm install
cd ui && npm install
```

### Development

Run the UI dev server with hot reload (no Electron shell):

```bash
cd ui && npx vite
```

Build the UI and launch the full Electron app:

```bash
npm start
```

### Build for Distribution

```bash
npm run dist          # all platforms
npm run dist:mac      # macOS .dmg
npm run dist:win      # Windows .nsis
npm run dist:linux    # Linux .AppImage
```

## Tech Stack

- **Electron** - Desktop shell and main process
- **SolidJS** - UI framework (JSX)
- **Vite** - Build tooling (`vite-plugin-solid`)
- **better-sqlite3** - Local app state and RFC index storage
- **pg** - PostgreSQL client for the database tool
- **ws** - WebSocket client
- **CodeMirror 6** - Code/SQL editor

## Data Storage

App data is stored at `~/.config/api-client/api-client.db` (SQLite).
