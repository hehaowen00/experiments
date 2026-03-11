const { ipcMain } = require('electron');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { generateKSUID } = require('./ksuid');

const net = require('net');

const activeServers = new Map(); // id -> { server, files: [], savePath }
const pendingFiles = new Map(); // fileId -> { data, filename, serverId, savePath, resolve }
const sharedFiles = new Map(); // fileId -> { name, path, size, serverId }

function isPrivateIP(ip) {
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true;

  // Strip IPv6-mapped IPv4 prefix
  const addr = ip.startsWith('::ffff:') ? ip.slice(7) : ip;

  if (!net.isIPv4(addr)) return false;

  const parts = addr.split('.').map(Number);
  // 10.0.0.0/8
  if (parts[0] === 10) return true;
  // 192.168.0.0/16
  if (parts[0] === 192 && parts[1] === 168) return true;
  // 169.254.0.0/16 (link-local)
  if (parts[0] === 169 && parts[1] === 254) return true;

  return false;
}

function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const iface of Object.values(interfaces)) {
    for (const info of iface) {
      if (info.family === 'IPv4' && !info.internal && isPrivateIP(info.address)) {
        ips.push(info.address);
      }
    }
  }
  return ips;
}

function register(mainWindow) {
  ipcMain.handle('drop:start', (_, opts) => {
    const { id, port, savePath } = opts;

    if (activeServers.has(id)) {
      return { error: 'Server already running' };
    }

    const resolvedPath = savePath || path.join(os.homedir(), 'Downloads');
    if (!fs.existsSync(resolvedPath)) {
      fs.mkdirSync(resolvedPath, { recursive: true });
    }

    const server = http.createServer((req, res) => {
      // Reject non-local-network connections
      const remoteAddr = req.socket.remoteAddress || '';
      if (!isPrivateIP(remoteAddr)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(getDropPage());
        return;
      }

      // Serve built assets (JS, CSS)
      if (req.method === 'GET' && req.url.startsWith('/assets/')) {
        const assetPath = path.join(__dirname, '..', 'ui', 'dist', req.url);
        if (fs.existsSync(assetPath)) {
          const ext = path.extname(assetPath);
          const types = { '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
          res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
          res.end(fs.readFileSync(assetPath));
          return;
        }
      }

      // List shared files as JSON
      if (req.method === 'GET' && req.url === '/files') {
        const list = [];
        for (const [fileId, shared] of sharedFiles) {
          if (shared.serverId === id) {
            list.push({
              id: fileId,
              name: shared.name,
              size: shared.size,
              url: `/files/${fileId}/${encodeURIComponent(shared.name)}`,
            });
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(list));
        return;
      }

      // Serve shared files: /files/<fileId>/<filename>
      if (req.method === 'GET' && req.url.startsWith('/files/')) {
        const parts = req.url.split('/');
        const fileId = parts[2];
        const shared = sharedFiles.get(fileId);
        if (shared && shared.serverId === id && fs.existsSync(shared.path)) {
          const stat = fs.statSync(shared.path);
          res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${encodeURIComponent(shared.name)}"`,
            'Content-Length': stat.size,
          });
          fs.createReadStream(shared.path).pipe(res);
          return;
        }
        res.writeHead(404);
        res.end('File not found');
        return;
      }

      if (req.method === 'POST' && req.url === '/upload') {
        handleUpload(req, res, id, resolvedPath, mainWindow);
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    try {
      server.listen(port || 9000, '0.0.0.0', () => {
        const addr = server.address();
        activeServers.set(id, { server, files: [], savePath: resolvedPath });
        mainWindow.webContents.send('drop:started', {
          id,
          port: addr.port,
          ips: getLocalIPs(),
        });
      });

      server.on('error', (err) => {
        activeServers.delete(id);
        mainWindow.webContents.send('drop:error', { id, error: err.message });
      });

      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('drop:stop', (_, id) => {
    const entry = activeServers.get(id);
    if (entry) {
      entry.server.close();
      activeServers.delete(id);

      // Reject all pending files for this server
      for (const [fileId, pending] of pendingFiles) {
        if (pending.serverId === id) {
          pending.resolve({ rejected: true });
          pendingFiles.delete(fileId);
        }
      }

      // Remove shared files for this server
      for (const [fileId, shared] of sharedFiles) {
        if (shared.serverId === id) {
          sharedFiles.delete(fileId);
        }
      }

      mainWindow.webContents.send('drop:stopped', { id });
    }
  });

  ipcMain.handle('drop:accept', (_, fileId) => {
    const pending = pendingFiles.get(fileId);
    if (!pending) return { error: 'File not found' };

    const { data, filename, sha256, serverId, savePath } = pending;

    // Sanitize filename
    const safeName = filename.replace(/[/\\:*?"<>|]/g, '_');
    let destPath = path.join(savePath, safeName);

    // Avoid overwriting
    if (fs.existsSync(destPath)) {
      const ext = path.extname(safeName);
      const base = path.basename(safeName, ext);
      let counter = 1;
      while (fs.existsSync(destPath)) {
        destPath = path.join(savePath, `${base} (${counter})${ext}`);
        counter++;
      }
    }

    fs.writeFileSync(destPath, data);

    const fileInfo = {
      id: fileId,
      name: path.basename(destPath),
      originalName: filename,
      size: data.length,
      sha256,
      path: destPath,
      time: Date.now(),
    };

    const entry = activeServers.get(serverId);
    if (entry) {
      entry.files.push(fileInfo);
    }

    pending.resolve({ accepted: true });
    pendingFiles.delete(fileId);

    mainWindow.webContents.send('drop:accepted', { id: serverId, file: fileInfo });

    return { ok: true };
  });

  ipcMain.handle('drop:reject', (_, fileId) => {
    const pending = pendingFiles.get(fileId);
    if (!pending) return { error: 'File not found' };

    pending.resolve({ rejected: true });
    pendingFiles.delete(fileId);

    mainWindow.webContents.send('drop:rejected', { id: pending.serverId, fileId });

    return { ok: true };
  });

  ipcMain.handle('drop:listFiles', (_, id) => {
    const entry = activeServers.get(id);
    if (!entry) return [];
    return entry.files;
  });

  ipcMain.handle('drop:pickFolder', async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('drop:shareFiles', async (_, serverId) => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled || result.filePaths.length === 0) return [];

    const entry = activeServers.get(serverId);
    if (!entry) return { error: 'Server not running' };

    const addr = entry.server.address();
    const ips = getLocalIPs();
    const host = ips.length > 0 ? ips[0] : 'localhost';

    const shared = [];
    for (const filePath of result.filePaths) {
      const fileId = generateKSUID();
      const name = path.basename(filePath);
      const stat = fs.statSync(filePath);
      const info = {
        id: fileId,
        name,
        path: filePath,
        size: stat.size,
        serverId,
        url: `http://${host}:${addr.port}/files/${fileId}/${encodeURIComponent(name)}`,
        time: Date.now(),
      };
      sharedFiles.set(fileId, info);
      shared.push(info);
    }

    return shared;
  });

  ipcMain.handle('drop:unshareFile', (_, fileId) => {
    sharedFiles.delete(fileId);
    return { ok: true };
  });
}

function handleUpload(req, res, serverId, savePath, mainWindow) {
  const contentType = req.headers['content-type'] || '';

  if (!contentType.startsWith('multipart/form-data')) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Expected multipart/form-data' }));
    return;
  }

  const boundaryMatch = contentType.match(/boundary=(.+)/);
  if (!boundaryMatch) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'No boundary found' }));
    return;
  }

  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    try {
      const body = Buffer.concat(chunks);
      const files = parseMultipart(body, boundaryMatch[1]);

      const promises = [];

      for (const file of files) {
        if (!file.filename) continue;

        const fileId = generateKSUID();
        const sha256 = crypto
          .createHash('sha256')
          .update(file.data)
          .digest('hex');

        const promise = new Promise((resolve) => {
          pendingFiles.set(fileId, {
            data: file.data,
            filename: file.filename,
            sha256,
            serverId,
            savePath,
            resolve,
          });
        });

        promises.push(promise);

        mainWindow.webContents.send('drop:pending', {
          id: serverId,
          fileId,
          name: file.filename,
          size: file.data.length,
          sha256,
          time: Date.now(),
        });
      }

      if (promises.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No files found' }));
        return;
      }

      // Wait for all files to be accepted or rejected
      Promise.all(promises).then((results) => {
        const accepted = results.filter((r) => r.accepted).length;
        const rejected = results.filter((r) => r.rejected).length;

        if (accepted > 0) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, accepted, rejected }));
        } else {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Rejected', rejected }));
        }
      });
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

function parseMultipart(body, boundary) {
  const files = [];
  const sep = Buffer.from('--' + boundary);

  let start = 0;
  while (true) {
    const partStart = indexOf(body, sep, start);
    if (partStart === -1) break;

    const nextStart = indexOf(body, sep, partStart + sep.length);
    if (nextStart === -1) break;

    // Skip the boundary line + CRLF
    let headerEnd = indexOf(body, Buffer.from('\r\n\r\n'), partStart + sep.length);
    if (headerEnd === -1) {
      start = nextStart;
      continue;
    }

    const headerSection = body.slice(partStart + sep.length + 2, headerEnd).toString('utf-8');
    const dataStart = headerEnd + 4;
    const dataEnd = nextStart - 2; // strip trailing CRLF before next boundary

    const filenameMatch = headerSection.match(/filename="([^"]+)"/);
    if (filenameMatch) {
      files.push({
        filename: filenameMatch[1],
        data: body.slice(dataStart, dataEnd),
      });
    }

    start = nextStart;
  }

  return files;
}

function indexOf(buf, search, fromIndex) {
  const idx = buf.indexOf(search, fromIndex);
  return idx;
}

let dropPageCache = null;

function getDropPage() {
  if (dropPageCache) return dropPageCache;
  const htmlPath = path.join(__dirname, '..', 'ui', 'dist', 'drop.html');
  if (fs.existsSync(htmlPath)) {
    dropPageCache = fs.readFileSync(htmlPath, 'utf-8');
    return dropPageCache;
  }
  return '<html><body><p>Drop page not built. Run npm run build first.</p></body></html>';
}

module.exports = { register };
