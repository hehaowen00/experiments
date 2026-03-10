const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');
const { generateKSUID } = require('./ksuid');

const activeSseConnections = new Map();

function buildMultipartBody(fields) {
  const boundary =
    '----FormBoundary' + generateKSUID().replace(/-/g, '').slice(0, 16);
  const parts = [];
  for (const f of fields) {
    if (f.type === 'file' && f.filePath) {
      if (!fs.existsSync(f.filePath)) continue;
      const fileData = fs.readFileSync(f.filePath);
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${f.key}"; filename="${f.fileName}"\r\nContent-Type: ${f.fileMimeType || 'application/octet-stream'}\r\n\r\n`,
        ),
      );
      parts.push(fileData);
      parts.push(Buffer.from('\r\n'));
    } else {
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${f.key}"\r\n\r\n${f.value || ''}\r\n`,
        ),
      );
    }
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function parseSseEvent(raw) {
  const lines = raw.split('\n');
  const event = { type: 'message', data: '', id: '', retry: null };
  for (const line of lines) {
    if (line.startsWith('event:')) event.type = line.slice(6).trim();
    else if (line.startsWith('data:'))
      event.data += (event.data ? '\n' : '') + line.slice(5).trimStart();
    else if (line.startsWith('id:')) event.id = line.slice(3).trim();
    else if (line.startsWith('retry:'))
      event.retry = parseInt(line.slice(6).trim());
  }
  return event;
}

function register(mainWindow) {
  ipcMain.handle('request:send', async (_, opts) => {
    const http = require('http');
    const https = require('https');
    const zlib = require('zlib');
    const { URL } = require('url');

    const { method, url, headers, bodyType, body, filePath, formFields } = opts;
    const h = {};
    if (headers) {
      for (const { key, value, enabled } of headers) {
        if (enabled && key) h[key.toLowerCase()] = value;
      }
    }

    if (!h['accept-encoding']) {
      h['accept-encoding'] = 'gzip, deflate, br';
    }

    // Build request body
    let reqBody = null;
    if (method !== 'GET' && method !== 'HEAD') {
      if (bodyType === 'file' && filePath) {
        if (fs.existsSync(filePath)) {
          reqBody = fs.readFileSync(filePath);
          if (!h['content-type']) {
            const ext = path.extname(filePath).toLowerCase();
            const mimeMap = {
              '.json': 'application/json',
              '.xml': 'application/xml',
              '.html': 'text/html',
              '.txt': 'text/plain',
              '.csv': 'text/csv',
              '.png': 'image/png',
              '.jpg': 'image/jpeg',
              '.gif': 'image/gif',
              '.pdf': 'application/pdf',
              '.zip': 'application/zip',
            };
            h['content-type'] = mimeMap[ext] || 'application/octet-stream';
          }
        }
      } else if (bodyType === 'form' && formFields && formFields.length) {
        const mp = buildMultipartBody(formFields);
        reqBody = mp.body;
        h['content-type'] = mp.contentType;
      } else if (body) {
        reqBody = Buffer.from(body);
      }
    }

    const timeline = [];
    const start = Date.now();
    const ts = () => Date.now() - start;
    const timing = { dns: null, connect: null, tls: null, ttfb: null };

    return new Promise((resolve) => {
      let parsed;
      try {
        parsed = new URL(url);
      } catch (e) {
        resolve({
          error: e.message,
          time: 0,
          contentType: '',
          timeline: [{ t: 0, type: 'error', text: `Invalid URL: ${e.message}` }],
        });
        return;
      }

      const isHttps = parsed.protocol === 'https:';
      const lib = isHttps ? https : http;

      timeline.push({
        t: ts(),
        type: 'info',
        text: `Preparing ${method} request to ${parsed.hostname}`,
      });
      timeline.push({
        t: ts(),
        type: 'req-header',
        text: `${method} ${parsed.pathname}${parsed.search} HTTP/1.1`,
      });
      timeline.push({
        t: ts(),
        type: 'req-header',
        text: `Host: ${parsed.host}`,
      });
      for (const [k, v] of Object.entries(h)) {
        timeline.push({ t: ts(), type: 'req-header', text: `${k}: ${v}` });
      }

      const reqOpts = {
        method,
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        headers: h,
        rejectUnauthorized: true,
      };

      const req = lib.request(reqOpts, (res) => {
        const elapsed = ts();
        timing.ttfb = elapsed;
        timeline.push({ t: elapsed, type: 'info', text: `Received response` });
        timeline.push({
          t: elapsed,
          type: 'res-status',
          text: `HTTP/${res.httpVersion} ${res.statusCode} ${res.statusMessage}`,
        });
        for (let i = 0; i < res.rawHeaders.length; i += 2) {
          timeline.push({
            t: elapsed,
            type: 'res-header',
            text: `${res.rawHeaders[i]}: ${res.rawHeaders[i + 1]}`,
          });
        }

        const respHeaders = {};
        res.headers &&
          Object.entries(res.headers).forEach(([k, v]) => {
            respHeaders[k] = v;
          });
        const ct = res.headers['content-type'] || '';

        // Decompress response based on content-encoding
        const encoding = (res.headers['content-encoding'] || '')
          .trim()
          .toLowerCase();
        let stream = res;
        if (encoding === 'gzip' || encoding === 'x-gzip') {
          stream = res.pipe(zlib.createGunzip());
        } else if (encoding === 'deflate') {
          stream = res.pipe(zlib.createInflate());
        } else if (encoding === 'br') {
          stream = res.pipe(zlib.createBrotliDecompress());
        }

        if (stream !== res) {
          timeline.push({
            t: ts(),
            type: 'info',
            text: `Decompressing response (${encoding})`,
          });
          stream.on('error', (err) => {
            const totalTime = ts();
            timeline.push({
              t: totalTime,
              type: 'error',
              text: `Decompression error: ${err.message}`,
            });
            resolve({
              error: `Decompression failed: ${err.message}`,
              time: totalTime,
              contentType: ct,
              timeline,
            });
          });
        }

        // SSE: stream events instead of buffering
        if (ct.includes('text/event-stream')) {
          const sseId = opts._requestId || Date.now().toString(36);
          activeSseConnections.set(sseId, req);
          resolve({
            status: res.statusCode,
            statusText: res.statusMessage,
            headers: respHeaders,
            time: ts(),
            contentType: ct,
            timeline,
            sse: true,
            sseId,
          });

          mainWindow.webContents.send('sse:open', {
            id: sseId,
            status: res.statusCode,
            statusText: res.statusMessage,
          });

          let buffer = '';
          stream.on('data', (chunk) => {
            buffer += chunk.toString('utf-8');
            const parts = buffer.split('\n\n');
            buffer = parts.pop();
            for (const raw of parts) {
              if (!raw.trim()) continue;
              const event = parseSseEvent(raw);
              mainWindow.webContents.send('sse:event', {
                id: sseId,
                event,
                raw: raw.trim(),
              });
            }
          });

          stream.on('end', () => {
            activeSseConnections.delete(sseId);
            mainWindow.webContents.send('sse:close', { id: sseId });
          });

          return;
        }

        const chunks = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', () => {
          const totalTime = ts();
          const buf = Buffer.concat(chunks);
          const isImage = ct.startsWith('image/');
          let responseBody;
          if (isImage) {
            responseBody = buf.toString('base64');
          } else {
            responseBody = buf.toString('utf-8');
            if (ct.includes('json')) {
              try {
                responseBody = JSON.stringify(JSON.parse(responseBody), null, 2);
              } catch {}
            }
          }
          timeline.push({
            t: totalTime,
            type: 'info',
            text: `Response body received (${buf.length} bytes)`,
          });
          timeline.push({
            t: totalTime,
            type: 'info',
            text: `Request completed in ${totalTime}ms`,
          });
          // Timing summary
          const transferTime = totalTime - (timing.ttfb || 0);
          const parts = [];
          if (timing.dns != null) parts.push(`DNS: ${timing.dns}ms`);
          if (timing.connect != null)
            parts.push(`TCP: ${timing.connect - (timing.dns || 0)}ms`);
          if (timing.tls != null)
            parts.push(`TLS: ${timing.tls - (timing.connect || 0)}ms`);
          if (timing.ttfb != null) parts.push(`TTFB: ${timing.ttfb}ms`);
          parts.push(`Transfer: ${transferTime}ms`);
          parts.push(`Total: ${totalTime}ms`);
          timeline.push({
            t: totalTime,
            type: 'timing',
            text: parts.join('  |  '),
          });
          resolve({
            status: res.statusCode,
            statusText: res.statusMessage,
            headers: respHeaders,
            body: responseBody,
            time: totalTime,
            contentType: ct,
            timeline,
            timing,
            isImage,
          });
        });
      });

      req.on('socket', (socket) => {
        if (socket.connecting) {
          timeline.push({
            t: ts(),
            type: 'info',
            text: `Connecting to ${parsed.hostname}:${reqOpts.port}...`,
          });
          socket.on('lookup', (err, address, family) => {
            timing.dns = ts();
            if (err) {
              timeline.push({
                t: timing.dns,
                type: 'error',
                text: `DNS lookup failed: ${err.message}`,
              });
            } else {
              timeline.push({
                t: timing.dns,
                type: 'info',
                text: `DNS resolved: ${address} (IPv${family}) in ${timing.dns}ms`,
              });
            }
          });
          socket.on('connect', () => {
            timing.connect = ts();
            const connectDuration = timing.connect - (timing.dns || 0);
            timeline.push({
              t: timing.connect,
              type: 'info',
              text: `TCP connection established in ${connectDuration}ms`,
            });
          });
        }
        if (isHttps) {
          socket.on('secureConnect', () => {
            timing.tls = ts();
            const tlsDuration = timing.tls - (timing.connect || 0);
            const cert = socket.getPeerCertificate();
            const cipher = socket.getCipher();
            const proto = socket.getProtocol();
            timeline.push({
              t: timing.tls,
              type: 'tls',
              text: `TLS handshake complete in ${tlsDuration}ms`,
            });
            if (proto)
              timeline.push({ t: ts(), type: 'tls', text: `Protocol: ${proto}` });
            if (cipher)
              timeline.push({
                t: ts(),
                type: 'tls',
                text: `Cipher: ${cipher.name}`,
              });
            if (cert && cert.subject) {
              timeline.push({
                t: ts(),
                type: 'tls',
                text: `Subject: ${cert.subject.CN || JSON.stringify(cert.subject)}`,
              });
              if (cert.subjectaltname) {
                timeline.push({
                  t: ts(),
                  type: 'tls',
                  text: `Alt Names: ${cert.subjectaltname}`,
                });
              }
              timeline.push({
                t: ts(),
                type: 'tls',
                text: `Issuer: ${cert.issuer?.CN || cert.issuer?.O || ''}`,
              });
              timeline.push({
                t: ts(),
                type: 'tls',
                text: `Valid: ${cert.valid_from} - ${cert.valid_to}`,
              });
              if (cert.serialNumber) {
                timeline.push({
                  t: ts(),
                  type: 'tls',
                  text: `Serial: ${cert.serialNumber}`,
                });
              }
              if (cert.fingerprint256) {
                timeline.push({
                  t: ts(),
                  type: 'tls',
                  text: `Fingerprint (SHA-256): ${cert.fingerprint256}`,
                });
              }
            }
          });
        }
      });

      req.on('error', (err) => {
        const totalTime = ts();
        timeline.push({
          t: totalTime,
          type: 'error',
          text: `${err.code || 'Error'}: ${err.message}`,
        });
        if (
          err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
          err.code === 'CERT_HAS_EXPIRED' ||
          err.code === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
          err.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
          err.code === 'SELF_SIGNED_CERT_IN_CHAIN'
        ) {
          timeline.push({
            t: totalTime,
            type: 'error',
            text: `SSL certificate verification failed`,
          });
        }
        if (err.code === 'ECONNREFUSED') {
          timeline.push({
            t: totalTime,
            type: 'error',
            text: `Connection refused by ${parsed.hostname}:${reqOpts.port}`,
          });
        }
        if (err.code === 'ENOTFOUND') {
          timeline.push({
            t: totalTime,
            type: 'error',
            text: `DNS lookup failed for ${parsed.hostname}`,
          });
        }
        resolve({
          error: err.message,
          time: totalTime,
          contentType: '',
          timeline,
        });
      });

      if (reqBody) {
        timeline.push({
          t: ts(),
          type: 'info',
          text: `Sending request body (${reqBody.length} bytes)`,
        });
        req.write(reqBody);
      }
      req.end();
    });
  });

  // --- SSE ---

  ipcMain.handle('sse:disconnect', (_, id) => {
    const req = activeSseConnections.get(id);
    if (req) {
      req.destroy();
      activeSseConnections.delete(id);
    }
  });
}

module.exports = { register };
