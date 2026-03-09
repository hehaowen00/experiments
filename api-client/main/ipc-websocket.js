const { ipcMain } = require('electron');
const WebSocket = require('ws');

const activeWsConnections = new Map();

function register(mainWindow) {
  ipcMain.handle('ws:connect', (_, opts) => {
    const { id, url, headers, protocols } = opts;
    const h = {};
    if (headers) {
      for (const { key, value, enabled } of headers) {
        if (enabled && key) h[key.toLowerCase()] = value;
      }
    }

    try {
      const ws = new WebSocket(url, protocols || [], {
        headers: h,
        rejectUnauthorized: true,
        perMessageDeflate: true,
      });

      ws.on('upgrade', (res) => {
        const headers = {};
        const raw = res.rawHeaders;
        for (let i = 0; i < raw.length; i += 2) {
          headers[raw[i].toLowerCase()] = raw[i + 1];
        }
        mainWindow.webContents.send('ws:open', { id, headers });
      });

      ws.on('message', (data, isBinary) => {
        const payload = isBinary
          ? `[Binary: ${data.length} bytes]`
          : data.toString('utf-8');
        mainWindow.webContents.send('ws:message', {
          id,
          data: payload,
          isBinary,
          time: Date.now(),
        });
      });

      ws.on('ping', (data) => {
        // ws library auto-replies with pong
        mainWindow.webContents.send('ws:ping', { id, data: data.toString() });
        mainWindow.webContents.send('ws:pong', {
          id,
          data: data.toString(),
          auto: true,
        });
      });

      ws.on('pong', (data) => {
        mainWindow.webContents.send('ws:pong', { id, data: data.toString() });
      });

      ws.on('close', (code, reason) => {
        activeWsConnections.delete(id);
        mainWindow.webContents.send('ws:close', {
          id,
          code,
          reason: reason.toString(),
        });
      });

      ws.on('error', (err) => {
        activeWsConnections.delete(id);
        mainWindow.webContents.send('ws:error', { id, error: err.message });
      });

      activeWsConnections.set(id, ws);
    } catch (e) {
      mainWindow.webContents.send('ws:error', { id, error: e.message });
    }
  });

  ipcMain.handle('ws:send', (_, opts) => {
    const { id, data, frameType } = opts;
    const ws = activeWsConnections.get(id);
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    if (frameType === 'ping') {
      ws.ping(data || '');
    } else if (frameType === 'pong') {
      ws.pong(data || '');
    } else if (frameType === 'binary') {
      ws.send(Buffer.from(data, 'utf-8'));
    } else {
      ws.send(data);
    }
    return true;
  });

  ipcMain.handle('ws:disconnect', (_, id) => {
    const ws = activeWsConnections.get(id);
    if (ws) {
      ws.close();
      activeWsConnections.delete(id);
    }
  });
}

module.exports = { register };
