const { ipcMain } = require('electron');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { generateKSUID } = require('./ksuid');

const net = require('net');

const activeServers = new Map(); // id -> { server, files: [], savePath }
const pendingFiles = new Map(); // fileId -> { data, filename, serverId, savePath, resolve }

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
        res.end(getUploadPage());
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

      mainWindow.webContents.send('drop:stopped', { id });
    }
  });

  ipcMain.handle('drop:accept', (_, fileId) => {
    const pending = pendingFiles.get(fileId);
    if (!pending) return { error: 'File not found' };

    const { data, filename, serverId, savePath } = pending;

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

        const promise = new Promise((resolve) => {
          pendingFiles.set(fileId, {
            data: file.data,
            filename: file.filename,
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

function getUploadPage() {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Conduit Drop</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #1a1a2e; color: #e0e0e0;
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
    }
    .container { max-width: 480px; width: 100%; padding: 2rem; }
    h1 { font-size: 1.5rem; margin-bottom: 1.5rem; text-align: center; color: #fff; }
    .drop-zone {
      border: 2px dashed #444; border-radius: 12px; padding: 3rem 2rem;
      text-align: center; cursor: pointer; transition: all 0.2s;
      background: #16213e;
    }
    .drop-zone.dragover { border-color: #6c63ff; background: #1a1a40; }
    .drop-zone p { margin-bottom: 1rem; color: #aaa; }
    .drop-zone .icon { font-size: 2.5rem; margin-bottom: 1rem; }
    input[type="file"] { display: none; }
    .btn {
      display: inline-block; padding: 0.6rem 1.5rem; background: #6c63ff;
      color: #fff; border: none; border-radius: 6px; cursor: pointer;
      font-size: 0.9rem; transition: background 0.2s;
    }
    .btn:hover { background: #5a52d5; }
    .status { margin-top: 1.5rem; }
    .file-item {
      display: flex; justify-content: space-between; align-items: center;
      padding: 0.5rem 0.75rem; background: #16213e; border-radius: 6px;
      margin-bottom: 0.5rem; font-size: 0.85rem;
    }
    .file-item .name { color: #fff; }
    .file-item .size { color: #888; }
    .file-item .ok { color: #4caf50; }
    .file-item .err { color: #f44; }
    .file-item .pending { color: #ffa726; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Conduit Drop</h1>
    <div class="drop-zone" id="dropZone">
      <div class="icon">&#128449;</div>
      <p>Drag & drop files here</p>
      <button class="btn" onclick="document.getElementById('fileInput').click()">Choose Files</button>
      <input type="file" id="fileInput" multiple>
    </div>
    <div class="status" id="status"></div>
  </div>
  <script>
    const dz = document.getElementById('dropZone');
    const fi = document.getElementById('fileInput');
    const st = document.getElementById('status');

    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('dragover'); upload(e.dataTransfer.files); });
    fi.addEventListener('change', () => { upload(fi.files); fi.value = ''; });

    function formatSize(b) {
      if (b < 1024) return b + ' B';
      if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
      return (b / 1048576).toFixed(1) + ' MB';
    }

    async function upload(files) {
      for (const f of files) {
        const el = document.createElement('div');
        el.className = 'file-item';
        el.innerHTML = '<span class="name">' + f.name + '</span><span class="size">' + formatSize(f.size) + '</span><span class="pending">Waiting...</span>';
        st.prepend(el);

        const fd = new FormData();
        fd.append('file', f);
        try {
          const r = await fetch('/upload', { method: 'POST', body: fd });
          const j = await r.json();
          if (j.ok) {
            el.lastChild.className = 'ok';
            el.lastChild.textContent = '\\u2713 Accepted';
          } else {
            el.lastChild.className = 'err';
            el.lastChild.textContent = j.error === 'Rejected' ? 'Rejected' : (j.error || 'Failed');
          }
        } catch (e) {
          el.lastChild.className = 'err';
          el.lastChild.textContent = 'Error';
        }
      }
    }
  </script>
</body>
</html>`;
}

module.exports = { register };
