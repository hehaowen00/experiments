const { ipcMain } = require('electron');
const https = require('https');
const store = require('./store');

function register(mainWindow) {
  ipcMain.handle('rfc:syncIndex', async () => {
    return syncRfcIndex(mainWindow);
  });

  ipcMain.handle('rfc:search', async (_, query, limit) => {
    return searchRfcs(query, limit || 100);
  });

  ipcMain.handle('rfc:get', async (_, number) => {
    return getRfc(number);
  });

  ipcMain.handle('rfc:getContent', async (_, number) => {
    return getRfcContent(number, mainWindow);
  });

  ipcMain.handle('rfc:getSyncStatus', async () => {
    return getSyncStatus();
  });

  ipcMain.handle('rfc:browse', async (_, offset, limit) => {
    return browseRfcs(offset || 0, limit || 100);
  });

  ipcMain.handle('rfc:getTitles', async (_, numbers) => {
    return getRfcTitles(numbers);
  });
}

function getSyncStatus() {
  const db = store.getRfcDb();
  const count = db.prepare('SELECT COUNT(*) as c FROM rfcs').get();
  const lastSync = db
    .prepare("SELECT value FROM rfc_meta WHERE key = 'last_sync'")
    .get();
  return {
    count: count.c,
    lastSync: lastSync ? lastSync.value : null,
  };
}

function searchRfcs(query, limit) {
  const db = store.getRfcDb();
  const q = query.trim();

  // If query is a number, try exact RFC match first
  const num = parseInt(q, 10);
  if (!isNaN(num) && String(num) === q) {
    const exact = db.prepare('SELECT * FROM rfcs WHERE number = ?').get(num);
    if (exact) {
      const rest = db
        .prepare(
          `SELECT * FROM rfcs WHERE number != ? AND
          (title LIKE ? OR CAST(number AS TEXT) LIKE ?)
          ORDER BY number ASC LIMIT ?`,
        )
        .all(num, `%${q}%`, `%${q}%`, limit - 1);
      return [formatRfcRow(exact), ...rest.map(formatRfcRow)];
    }
  }

  // Full text search on title and keywords
  const results = db
    .prepare(
      `SELECT * FROM rfcs WHERE
      title LIKE ? OR CAST(number AS TEXT) LIKE ? OR keywords LIKE ?
      ORDER BY number ASC LIMIT ?`,
    )
    .all(`%${q}%`, `%${q}%`, `%${q}%`, limit);
  return results.map(formatRfcRow);
}

function browseRfcs(offset, limit) {
  const db = store.getRfcDb();
  const results = db
    .prepare('SELECT * FROM rfcs ORDER BY number DESC LIMIT ? OFFSET ?')
    .all(limit, offset);
  return results.map(formatRfcRow);
}

function getRfc(number) {
  const db = store.getRfcDb();
  const row = db.prepare('SELECT * FROM rfcs WHERE number = ?').get(number);
  if (!row) return null;
  return formatRfcRow(row);
}

function getRfcTitles(numbers) {
  const db = store.getRfcDb();
  if (!numbers || numbers.length === 0) return {};
  const placeholders = numbers.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT number, title FROM rfcs WHERE number IN (${placeholders})`)
    .all(...numbers);
  const map = {};
  for (const r of rows) {
    map[r.number] = r.title;
  }
  return map;
}

async function getRfcContent(number, mainWindow) {
  const db = store.getRfcDb();

  // Check cache
  const cached = db
    .prepare('SELECT content FROM rfc_content WHERE number = ?')
    .get(number);
  if (cached) return cached.content.replace(/^\n+/, '');

  // Download from IETF
  const content = await fetchText(
    `https://www.rfc-editor.org/rfc/rfc${number}.txt`,
  );

  const trimmed = content.replace(/^\n+/, '');

  // Cache it
  db.prepare(
    'INSERT OR REPLACE INTO rfc_content (number, content) VALUES (?, ?)',
  ).run(number, trimmed);

  return trimmed;
}

async function syncRfcIndex(mainWindow) {
  // Download RFC index XML from IETF
  mainWindow.webContents.send('rfc:syncProgress', {
    stage: 'downloading',
    message: 'Downloading RFC index...',
  });

  const xml = await fetchText('https://www.rfc-editor.org/rfc-index.xml');

  mainWindow.webContents.send('rfc:syncProgress', {
    stage: 'parsing',
    message: 'Parsing RFC index...',
  });

  // Parse RFC entries from XML
  const rfcs = parseRfcIndex(xml);

  mainWindow.webContents.send('rfc:syncProgress', {
    stage: 'saving',
    message: `Saving ${rfcs.length} RFCs to database...`,
  });

  const db = store.getRfcDb();

  const insert = db.prepare(`
    INSERT OR REPLACE INTO rfcs
      (number, title, authors, date_month, date_year, status, keywords,
       abstract, is_also, updated_by, obsoleted_by, obsoletes, updates)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (const rfc of rfcs) {
      insert.run(
        rfc.number,
        rfc.title,
        rfc.authors,
        rfc.dateMonth,
        rfc.dateYear,
        rfc.status,
        rfc.keywords,
        rfc.abstract,
        rfc.references,
        rfc.updatedBy,
        rfc.obsoletedBy,
        rfc.obsoletes,
        rfc.updates,
      );
    }
  });

  tx();

  // Download all RFC content
  const cachedSet = new Set(
    db
      .prepare('SELECT number FROM rfc_content')
      .all()
      .map((r) => r.number),
  );
  const toDownload = rfcs
    .map((r) => r.number)
    .filter((n) => !cachedSet.has(n));

  const total = toDownload.length;
  let downloaded = 0;
  let failed = 0;
  const CONCURRENCY = 10;

  const insertContent = db.prepare(
    'INSERT OR REPLACE INTO rfc_content (number, content) VALUES (?, ?)',
  );

  async function downloadOne(number) {
    try {
      const content = await fetchText(
        `https://www.rfc-editor.org/rfc/rfc${number}.txt`,
      );
      insertContent.run(number, content);
      downloaded++;
    } catch {
      failed++;
    }
    if ((downloaded + failed) % 50 === 0 || downloaded + failed === total) {
      mainWindow.webContents.send('rfc:syncProgress', {
        stage: 'content',
        message: `Downloading RFCs: ${downloaded + failed}/${total} (${failed} failed)`,
      });
    }
  }

  if (total > 0) {
    mainWindow.webContents.send('rfc:syncProgress', {
      stage: 'content',
      message: `Downloading ${total} RFC documents...`,
    });

    // Process in batches with concurrency limit
    for (let i = 0; i < toDownload.length; i += CONCURRENCY) {
      const batch = toDownload.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(downloadOne));
    }
  }

  // Store sync time
  db.prepare(
    "INSERT OR REPLACE INTO rfc_meta (key, value) VALUES ('last_sync', ?)",
  ).run(new Date().toISOString());

  mainWindow.webContents.send('rfc:syncProgress', {
    stage: 'done',
    message: `Synced ${rfcs.length} RFCs, downloaded ${downloaded} documents${failed ? ` (${failed} failed)` : ''}`,
  });

  return { count: rfcs.length, downloaded, failed };
}

function parseRfcIndex(xml) {
  const rfcs = [];
  // Match each <rfc-entry>...</rfc-entry>
  const entryRegex = /<rfc-entry>([\s\S]*?)<\/rfc-entry>/g;
  let match;

  while ((match = entryRegex.exec(xml)) !== null) {
    const entry = match[1];

    const number = extractTag(entry, 'doc-id');
    if (!number) continue;
    const num = parseInt(number.replace(/^RFC0*/, ''), 10);
    if (isNaN(num)) continue;

    const title = extractTag(entry, 'title');
    const authors = extractAuthors(entry);
    const dateMonth = extractTag(entry, 'month') || '';
    const dateYear = extractTag(entry, 'year') || '';
    const status = extractTag(entry, 'current-status') || '';
    const keywords = extractAllTags(entry, 'kw').join(', ');
    const abstract = extractAbstract(entry);

    // Cross-references
    const references = extractDocIds(entry, 'is-also');
    const updatedBy = extractDocIds(entry, 'updated-by');
    const obsoletedBy = extractDocIds(entry, 'obsoleted-by');
    const obsoletes = extractDocIds(entry, 'obsoletes');
    const updates = extractDocIds(entry, 'updates');

    rfcs.push({
      number: num,
      title: title || '',
      authors,
      dateMonth,
      dateYear,
      status,
      keywords,
      abstract: abstract || '',
      references,
      updatedBy,
      obsoletedBy,
      obsoletes,
      updates,
    });
  }

  return rfcs;
}

function extractTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>(.*?)</${tag}>`, 's'));
  return m ? m[1].trim() : null;
}

function extractAllTags(xml, tag) {
  const results = [];
  const regex = new RegExp(`<${tag}>(.*?)</${tag}>`, 'gs');
  let m;
  while ((m = regex.exec(xml)) !== null) {
    results.push(m[1].trim());
  }
  return results;
}

function extractAuthors(xml) {
  const names = [];
  const authorRegex = /<author>[\s\S]*?<\/author>/g;
  let m;
  while ((m = authorRegex.exec(xml)) !== null) {
    const name = extractTag(m[0], 'name');
    if (name) names.push(name);
  }
  return names.join(', ');
}

function extractAbstract(xml) {
  const m = xml.match(/<abstract>([\s\S]*?)<\/abstract>/);
  if (!m) return '';
  // Strip inner XML tags, keep text
  return m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractDocIds(xml, containerTag) {
  const m = xml.match(
    new RegExp(`<${containerTag}>([\\s\\S]*?)</${containerTag}>`),
  );
  if (!m) return '';
  const ids = [];
  const docRegex = /<doc-id>(.*?)<\/doc-id>/g;
  let dm;
  while ((dm = docRegex.exec(m[1])) !== null) {
    ids.push(dm[1].trim());
  }
  return ids.join(', ');
}

function formatRfcRow(row) {
  return {
    number: row.number,
    title: row.title,
    authors: row.authors,
    dateMonth: row.date_month,
    dateYear: row.date_year,
    status: row.status,
    keywords: row.keywords,
    abstract: row.abstract,
    references: row.is_also,
    updatedBy: row.updated_by,
    obsoletedBy: row.obsoleted_by,
    obsoletes: row.obsoletes,
    updates: row.updates,
  };
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchText(res.headers.location).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

module.exports = { register };
