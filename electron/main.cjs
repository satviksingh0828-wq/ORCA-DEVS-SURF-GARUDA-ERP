const { app, BrowserWindow, desktopCapturer, ipcMain, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

// ── Data directory ─────────────────────────────────────────────────────────
// Portable: data folder lives next to the exe (or in project root during dev)
const DATA_DIR = app.isPackaged
  ? path.join(path.dirname(process.execPath), 'data')
  : path.join(__dirname, '..', 'data');

const COMPANIES_FILE = path.join(DATA_DIR, 'companies.json');
const RCLONE_FOLDER = 'rclone-v1.74.4-windows-386';
const RCLONE_REMOTE = 'mega:CompanyData';
let backupInProgress = false;
let lastBackup = null;

const TABLES = [
  'employees', 'departments', 'positions', 'attendance', 'holidays',
  'payrolls', 'loans', 'advances', 'loss_deductions', 'app_settings',
  'loan_installments', 'advance_installments', 'checkin_logs', 'employee_documents',
];

function nowIso() { return new Date().toISOString(); }
function genId()  { return crypto.randomUUID(); }

// ── Top-level data dir ─────────────────────────────────────────────────────
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(COMPANIES_FILE)) {
    fs.writeFileSync(COMPANIES_FILE, '[]', 'utf8');
  }
  // Ensure every existing company has all table files (handles new tables added after first run)
  try {
    const companies = JSON.parse(fs.readFileSync(COMPANIES_FILE, 'utf8'));
    for (const company of companies) {
      if (company && company.id) ensureCompanyDir(company.id);
    }
  } catch { /* ignore parse errors on corrupt file */ }
}

// ── Companies registry ─────────────────────────────────────────────────────
function readCompanies() {
  if (!fs.existsSync(COMPANIES_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(COMPANIES_FILE, 'utf8')); }
  catch { return []; }
}

function writeCompanies(data) {
  if (backupInProgress) throw new Error('Backup in progress. Please wait until it finishes before changing data.');
  fs.writeFileSync(COMPANIES_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function getCompanyDir(companyId) {
  return path.join(DATA_DIR, companyId);
}

function ensureCompanyDir(companyId) {
  const dir = getCompanyDir(companyId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  for (const t of TABLES) {
    const file = path.join(dir, `${t}.json`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, '[]', 'utf8');
  }
}

function writeBlockedResult() {
  return { data: null, error: { message: 'Backup in progress. Please wait until it finishes before changing data.' } };
}

function getRclonePaths() {
  const candidates = [
    path.join(path.dirname(process.execPath), RCLONE_FOLDER),
    path.join(app.getAppPath(), RCLONE_FOLDER),
    path.join(process.resourcesPath || '', RCLONE_FOLDER),
  ];
  const folder = candidates.find(dir => fs.existsSync(path.join(dir, 'rclone.exe')));
  return {
    folder: folder || candidates[0],
    executable: folder ? path.join(folder, 'rclone.exe') : path.join(candidates[0], 'rclone.exe'),
    config: folder ? path.join(folder, 'rclone.conf') : path.join(candidates[0], 'rclone.conf'),
  };
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, ...options });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error((stderr || stdout || `${command} exited with code ${code}`).trim()));
    });
  });
}

function powershellQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function createDataZip(zipPath) {
  if (process.platform === 'win32') {
    const command = `Compress-Archive -Path ${powershellQuote(DATA_DIR)} -DestinationPath ${powershellQuote(zipPath)} -CompressionLevel Optimal -Force`;
    await runCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command]);
  } else {
    await runCommand('zip', ['-qr', zipPath, path.basename(DATA_DIR)], { cwd: path.dirname(DATA_DIR) });
  }
}

async function rcloneCommand(args, rclone) {
  return runCommand(rclone.executable, ['--config', rclone.config, ...args]);
}

function backupFileName() {
  return `company-data-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
}

async function performBackup() {
  const rclone = getRclonePaths();
  if (!fs.existsSync(rclone.executable)) {
    throw new Error(`rclone.exe was not found. Add ${RCLONE_FOLDER}\\rclone.exe beside the EXE.`);
  }
  if (!fs.existsSync(rclone.config)) {
    throw new Error(`rclone.conf was not found. Add ${RCLONE_FOLDER}\\rclone.conf beside the EXE.`);
  }

  ensureDataDir();
  const filename = backupFileName();
  const zipPath = path.join(app.getPath('temp'), filename);
  const remoteTemp = `${RCLONE_REMOTE}/${filename}.uploading`;
  const remoteFinal = `${RCLONE_REMOTE}/${filename}`;
  let uploadedTemp = false;

  try {
    await createDataZip(zipPath);
    const localSize = fs.statSync(zipPath).size;
    if (!localSize) throw new Error('The data ZIP was empty, so it was not uploaded.');

    await rcloneCommand(['mkdir', RCLONE_REMOTE], rclone);
    await rcloneCommand(['copyto', zipPath, remoteTemp], rclone);
    uploadedTemp = true;

    const remoteListing = await rcloneCommand(['size', '--json', remoteTemp], rclone);
    let remoteSize = 0;
    try {
      const listed = JSON.parse(remoteListing.stdout || '{}');
      remoteSize = Number(listed?.bytes || 0);
    } catch {
      throw new Error('Cloud verification failed: rclone returned an unreadable size response.');
    }
    if (remoteSize && remoteSize !== localSize) {
      throw new Error(`Cloud verification failed: local ZIP is ${localSize} bytes but cloud ZIP is ${remoteSize} bytes.`);
    }

    await rcloneCommand(['moveto', remoteTemp, remoteFinal], rclone);
    uploadedTemp = false;

    const oldListing = await rcloneCommand(['lsf', '--files-only', RCLONE_REMOTE], rclone);
    const oldBackups = oldListing.stdout
      .split(/\r?\n/)
      .map(name => name.trim())
      .filter(name => /^company-data-backup-.*\.zip$/i.test(name) && name !== filename);
    for (const oldName of oldBackups) {
      await rcloneCommand(['deletefile', `${RCLONE_REMOTE}/${oldName}`], rclone);
    }

    lastBackup = {
      filename,
      completedAt: new Date().toISOString(),
      size: localSize,
      deletedOldBackups: oldBackups.length,
    };
    return {
      ...lastBackup,
      dataDir: DATA_DIR,
      remote: RCLONE_REMOTE,
    };
  } finally {
    if (uploadedTemp) {
      try { await rcloneCommand(['deletefile', remoteTemp], rclone); } catch {}
    }
    try { if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath); } catch {}
  }
}

function getBackupStatus() {
  ensureDataDir();
  const rclone = getRclonePaths();
  const companies = readCompanies();
  let missingTableFiles = 0;
  for (const company of companies) {
    if (!company?.id) continue;
    const companyDir = getCompanyDir(company.id);
    for (const table of TABLES) {
      if (!fs.existsSync(path.join(companyDir, `${table}.json`))) missingTableFiles++;
    }
  }
  return {
    dataDir: DATA_DIR,
    companyCount: companies.filter(company => company?.id).length,
    missingTableFiles,
    dataFolderReady: fs.existsSync(DATA_DIR) && fs.existsSync(COMPANIES_FILE) && missingTableFiles === 0,
    rcloneConfigured: fs.existsSync(rclone.executable) && fs.existsSync(rclone.config),
    rcloneFolder: rclone.folder,
    remote: RCLONE_REMOTE,
    inProgress: backupInProgress,
    lastBackup,
  };
}

// ── Per-company table I/O ──────────────────────────────────────────────────
function readTable(companyId, table) {
  const file = path.join(getCompanyDir(companyId), `${table}.json`);
  if (!fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return []; }
}

function writeTable(companyId, table, data) {
  if (backupInProgress) throw new Error('Backup in progress. Please wait until it finishes before changing data.');
  const dir = getCompanyDir(companyId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${table}.json`), JSON.stringify(data, null, 2), 'utf8');
}

function getEmployeeDocumentsDir(companyId, employeeId) {
  return path.join(getCompanyDir(companyId), 'employee_documents', employeeId);
}

function safeDocumentExtension(name) {
  const match = String(name || '').toLowerCase().match(/\.([a-z0-9]{1,10})$/);
  return match ? `.${match[1]}` : '';
}

function documentMimeType(mime, name) {
  if (mime) return mime;
  const ext = safeDocumentExtension(name);
  const map = {
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.webp': 'image/webp',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return map[ext] || 'application/octet-stream';
}

// ── Filter logic ───────────────────────────────────────────────────────────
function matchesFilters(row, filters) {
  for (const f of (filters || [])) {
    const v = row[f.col];
    switch (f.op) {
      case 'eq':  if (v !== f.val) return false; break;
      case 'neq': if (v === f.val) return false; break;
      case 'gte': {
        const nv = Number(v), nf = Number(f.val);
        const ok = (!isNaN(nv) && !isNaN(nf)) ? nv >= nf : String(v) >= String(f.val);
        if (!ok) return false; break;
      }
      case 'lte': {
        const nv = Number(v), nf = Number(f.val);
        const ok = (!isNaN(nv) && !isNaN(nf)) ? nv <= nf : String(v) <= String(f.val);
        if (!ok) return false; break;
      }
      case 'in':  if (!Array.isArray(f.val) || !f.val.includes(v)) return false; break;
      case 'is':  if (v !== f.val) return false; break;
    }
  }
  return true;
}

// ── IPC: Company management ────────────────────────────────────────────────
ipcMain.handle('companies-list', async () => {
  try { return { data: readCompanies(), error: null }; }
  catch (e) { return { data: null, error: { message: e.message } }; }
});

ipcMain.handle('companies-create', async (_event, { name, address, hue }) => {
  try {
    if (backupInProgress) return writeBlockedResult();
    const id = genId();
    const company = { id, name, address: address || '', hue: hue ?? 25, logo_ext: null, created_at: nowIso() };
    const companies = readCompanies();
    companies.push(company);
    writeCompanies(companies);
    ensureCompanyDir(id);
    return { data: company, error: null };
  } catch (e) { return { data: null, error: { message: e.message } }; }
});

ipcMain.handle('companies-update', async (_event, { id, ...patch }) => {
  try {
    if (backupInProgress) return writeBlockedResult();
    const companies = readCompanies();
    const idx = companies.findIndex(c => c.id === id);
    if (idx < 0) return { data: null, error: { message: 'Company not found' } };
    companies[idx] = { ...companies[idx], ...patch };
    writeCompanies(companies);
    return { data: companies[idx], error: null };
  } catch (e) { return { data: null, error: { message: e.message } }; }
});

ipcMain.handle('companies-delete', async (_event, id) => {
  try {
    if (backupInProgress) return writeBlockedResult();
    let companies = readCompanies();
    companies = companies.filter(c => c.id !== id);
    writeCompanies(companies);
    const dir = getCompanyDir(id);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    return { data: null, error: null };
  } catch (e) { return { data: null, error: { message: e.message } }; }
});

ipcMain.handle('companies-save-logo', async (_event, { companyId, ext, buffer }) => {
  try {
    if (backupInProgress) return writeBlockedResult();
    const dir = getCompanyDir(companyId);
    fs.mkdirSync(dir, { recursive: true });
    // Remove old logo files
    for (const e of ['jpg', 'jpeg', 'png', 'webp', 'gif']) {
      const old = path.join(dir, `logo.${e}`);
      if (fs.existsSync(old)) fs.unlinkSync(old);
    }
    fs.writeFileSync(path.join(dir, `logo.${ext}`), Buffer.from(buffer));
    // Update company record
    const companies = readCompanies();
    const idx = companies.findIndex(c => c.id === companyId);
    if (idx >= 0) { companies[idx].logo_ext = ext; writeCompanies(companies); }
    return { data: { logo_ext: ext }, error: null };
  } catch (e) { return { data: null, error: { message: e.message } }; }
});

ipcMain.handle('companies-get-logo', async (_event, companyId) => {
  try {
    const companies = readCompanies();
    const company = companies.find(c => c.id === companyId);
    if (!company?.logo_ext) return { data: null, error: null };
    const logoPath = path.join(getCompanyDir(companyId), `logo.${company.logo_ext}`);
    if (!fs.existsSync(logoPath)) return { data: null, error: null };
    const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
    const mime = mimeMap[company.logo_ext] || 'image/jpeg';
    const b64 = fs.readFileSync(logoPath).toString('base64');
    return { data: `data:${mime};base64,${b64}`, error: null };
  } catch (e) { return { data: null, error: { message: e.message } }; }
});

// ── Backup ─────────────────────────────────────────────────────────────────
ipcMain.handle('backup-status', async () => {
  try { return { data: getBackupStatus(), error: null }; }
  catch (e) { return { data: null, error: { message: e.message } }; }
});

ipcMain.handle('backup-start', async () => {
  if (backupInProgress) {
    return { data: null, error: { message: 'A backup is already running.' } };
  }
  backupInProgress = true;
  try {
    return { data: await performBackup(), error: null };
  } catch (e) {
    return { data: null, error: { message: e.message } };
  } finally {
    backupInProgress = false;
  }
});

// ── Employee documents ─────────────────────────────────────────────────────
ipcMain.handle('employee-documents-list', async (_event, { companyId, employeeId }) => {
  try {
    const rows = readTable(companyId, 'employee_documents')
      .filter(row => row.employee_id === employeeId)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return { data: rows, error: null };
  } catch (e) { return { data: null, error: { message: e.message } }; }
});

ipcMain.handle('employee-documents-upload', async (_event, { companyId, employeeId, originalName, mimeType, buffer }) => {
  try {
    if (backupInProgress) return writeBlockedResult();
    ensureCompanyDir(companyId);
    const id = genId();
    const ext = safeDocumentExtension(originalName);
    const storedName = `${id}${ext}`;
    const dir = getEmployeeDocumentsDir(companyId, employeeId);
    fs.mkdirSync(dir, { recursive: true });
    const bytes = Buffer.from(buffer);
    fs.writeFileSync(path.join(dir, storedName), bytes);
    const ts = nowIso();
    const metadata = {
      id, employee_id: employeeId, original_name: String(originalName || 'document'),
      stored_name: storedName, mime_type: documentMimeType(mimeType, originalName),
      size: bytes.length, created_at: ts, updated_at: ts,
    };
    writeTable(companyId, 'employee_documents', [...readTable(companyId, 'employee_documents'), metadata]);
    const { stored_name: _storedName, ...publicMetadata } = metadata;
    return { data: publicMetadata, error: null };
  } catch (e) { return { data: null, error: { message: e.message } }; }
});

ipcMain.handle('employee-documents-get', async (_event, { companyId, documentId }) => {
  try {
    const row = readTable(companyId, 'employee_documents').find(item => item.id === documentId);
    if (!row) return { data: null, error: { message: 'Document not found' } };
    const filePath = path.join(getEmployeeDocumentsDir(companyId, row.employee_id), row.stored_name);
    if (!fs.existsSync(filePath)) return { data: null, error: { message: 'Document file not found' } };
    const b64 = fs.readFileSync(filePath).toString('base64');
    return { data: { ...row, data_url: `data:${documentMimeType(row.mime_type, row.original_name)};base64,${b64}` }, error: null };
  } catch (e) { return { data: null, error: { message: e.message } }; }
});

ipcMain.handle('employee-documents-delete', async (_event, { companyId, documentId }) => {
  try {
    if (backupInProgress) return writeBlockedResult();
    const rows = readTable(companyId, 'employee_documents');
    const row = rows.find(item => item.id === documentId);
    if (!row) return { data: null, error: { message: 'Document not found' } };
    const filePath = path.join(getEmployeeDocumentsDir(companyId, row.employee_id), row.stored_name);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    writeTable(companyId, 'employee_documents', rows.filter(item => item.id !== documentId));
    return { data: null, error: null };
  } catch (e) { return { data: null, error: { message: e.message } }; }
});

// ── IPC: DB operations (per-company) ──────────────────────────────────────
ipcMain.handle('db-op', async (_event, desc) => {
  try {
    const { companyId, table, op } = desc;
    if (!companyId) return { data: null, error: { message: 'No companyId in request' } };
    if (backupInProgress && ['insert', 'update', 'delete', 'upsert'].includes(op)) {
      return writeBlockedResult();
    }
    const ts = nowIso();
    let rows = readTable(companyId, table);
    const filters = desc.filters || [];

    switch (op) {
      case 'select': {
        let res = rows.filter(r => matchesFilters(r, filters));
        if (desc.orderBy) {
          const { col, ascending = true } = desc.orderBy;
          res = res.slice().sort((a, b) => {
            const av = a[col] ?? '', bv = b[col] ?? '';
            if (av < bv) return ascending ? -1 : 1;
            if (av > bv) return ascending ? 1 : -1;
            return 0;
          });
        }
        if (desc.limit) res = res.slice(0, desc.limit);
        if (desc.single) {
          return res.length
            ? { data: res[0], error: null }
            : { data: null, error: { message: 'Row not found', code: 'PGRST116' } };
        }
        if (desc.maybeSingle) return { data: res[0] ?? null, error: null };
        return { data: res, error: null };
      }

      case 'insert': {
        const items = Array.isArray(desc.data) ? desc.data : [desc.data];
        const created = items.map(item => ({
          id: item.id || genId(), ...item, created_at: ts, updated_at: ts,
        }));
        writeTable(companyId, table, [...rows, ...created]);
        if (desc.single) return { data: created[0], error: null };
        return { data: created, error: null };
      }

      case 'update': {
        let lastUpdated = null;
        const newRows = rows.map(r => {
          if (!matchesFilters(r, filters)) return r;
          const u = { ...r, ...desc.data, updated_at: ts };
          lastUpdated = u;
          return u;
        });
        writeTable(companyId, table, newRows);
        if (desc.returnAll) return { data: newRows.filter(r => matchesFilters(r, filters)), error: null };
        if (desc.single) return { data: lastUpdated, error: null };
        return { data: null, error: null };
      }

      case 'delete': {
        writeTable(companyId, table, rows.filter(r => !matchesFilters(r, filters)));
        return { data: null, error: null };
      }

      case 'upsert': {
        const items = Array.isArray(desc.data) ? desc.data : [desc.data];
        const cc = desc.upsertConflict
          ? desc.upsertConflict.split(',').map(s => s.trim())
          : ['id'];
        for (const item of items) {
          const idx = rows.findIndex(r => cc.every(c => r[c] === item[c]));
          if (idx >= 0) {
            rows[idx] = { ...rows[idx], ...item, updated_at: ts };
          } else {
            rows.push({ id: item.id || genId(), ...item, created_at: ts, updated_at: ts });
          }
        }
        writeTable(companyId, table, rows);
        return { data: null, error: null };
      }

      default:
        return { data: null, error: { message: `Unknown op: ${op}` } };
    }
  } catch (e) {
    return { data: null, error: { message: e.message } };
  }
});

// ── WhatsApp (Baileys — WebSocket only, no Chrome/Puppeteer needed) ──────────
// Session stored in DATA_DIR/whatsapp_session as small JSON files.
let waSocket = null;
let waState = { status: 'idle', qr: null, phone: null, error: null, message: null };
let waReconnectCount = 0;
const WA_MAX_RECONNECT = 3;

function getWaDir() {
  return path.join(DATA_DIR, 'whatsapp_session');
}

// Silent logger — suppress Baileys internal noise
const waLogger = {
  level: 'silent',
  trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, fatal: () => {},
  child: function () { return waLogger; },
};

async function initWhatsApp() {
  try {
    // Load Baileys via dynamic import() — it is ESM-only and cannot be require()'d.
    const baileysModule = await import('@whiskeysockets/baileys');
    const makeWASocket = baileysModule.makeWASocket ?? baileysModule.default?.makeWASocket ?? baileysModule.default;
    const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = baileysModule;
    const QRCodeMod = await import('qrcode');
    const QRCode = QRCodeMod.default ?? QRCodeMod;

    const WA_DIR = getWaDir();
    fs.mkdirSync(WA_DIR, { recursive: true });

    // Tear down any existing socket
    if (waSocket) {
      try { waSocket.end(undefined); } catch {}
      waSocket = null;
    }

    waState = { status: 'initializing', qr: null, phone: null, error: null, message: 'Starting WhatsApp…' };

    const { state, saveCreds } = await useMultiFileAuthState(WA_DIR);

    // Fetch latest WA version with fallback
    let version = [2, 3000, 1015901307];
    try {
      const latest = await fetchLatestBaileysVersion();
      version = latest.version;
    } catch { /* use fallback */ }

    const sock = makeWASocket({
      version,
      auth: state,
      logger: waLogger,
      printQRInTerminal: false,
      browser: ['Garuda HRMS', 'Chrome', '1.0'],
      connectTimeoutMs: 30000,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          const dataUrl = await QRCode.toDataURL(qr);
          waState = { ...waState, status: 'qr', qr: dataUrl, error: null, message: null };
        } catch {
          waState = { ...waState, status: 'qr', qr: null, message: null };
        }
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        waSocket = null;

        if (loggedOut) {
          const WA_DIR2 = getWaDir();
          try { fs.rmSync(WA_DIR2, { recursive: true, force: true }); } catch {}
          waState = { status: 'idle', qr: null, phone: null, error: 'Logged out', message: null };
          waReconnectCount = 0;
        } else if (waReconnectCount < WA_MAX_RECONNECT) {
          waReconnectCount++;
          waState = { status: 'initializing', qr: null, phone: null, error: null, message: `Reconnecting (${waReconnectCount}/${WA_MAX_RECONNECT})…` };
          setTimeout(() => initWhatsApp().catch(() => {
            waState = { status: 'disconnected', qr: null, phone: null, error: null, message: null };
          }), 3000);
        } else {
          waReconnectCount = 0;
          waState = { status: 'disconnected', qr: null, phone: null, error: null, message: null };
        }
      } else if (connection === 'open') {
        waReconnectCount = 0;
        const phone = sock.user?.id?.split(':')[0] ?? null;
        waState = { status: 'connected', qr: null, phone: phone ? `+${phone}` : null, error: null, message: null };
        console.log('[WA] Connected as', phone);
      }
    });

    waSocket = sock;
  } catch (e) {
    console.error('[WA] initWhatsApp error:', e.message);
    waState = { status: 'error', qr: null, phone: null, error: e.message, message: null };
  }
}

ipcMain.handle('wa-status', async () => waState);

ipcMain.handle('wa-init', async () => {
  try {
    waReconnectCount = 0;
    await initWhatsApp();
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('wa-logout', async () => {
  try {
    waReconnectCount = WA_MAX_RECONNECT + 1; // prevent auto-reconnect after logout
    if (waSocket) {
      await waSocket.logout().catch(() => {});
      waSocket = null;
    }
    const WA_DIR = getWaDir();
    try { fs.rmSync(WA_DIR, { recursive: true, force: true }); } catch {}
    waState = { status: 'idle', qr: null, phone: null, error: null, message: null };
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('wa-send', async (_event, { to, message }) => {
  try {
    if (!waSocket || waState.status !== 'connected')
      return { error: 'WhatsApp is not connected' };
    const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
    await waSocket.sendMessage(jid, { text: message });
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('wa-send-doc', async (_event, { to, pdfBase64, filename, caption }) => {
  try {
    if (!waSocket || waState.status !== 'connected')
      return { error: 'WhatsApp is not connected' };
    const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
    await waSocket.sendMessage(jid, {
      document: Buffer.from(pdfBase64, 'base64'),
      mimetype: 'application/pdf',
      fileName: filename || 'document.pdf',
      caption: caption || '',
    });
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
});

// ── Window ─────────────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    title: 'Garuda HRMS',
    show: false,
    backgroundColor: '#ffffff',
  });

  if (!app.isPackaged) {
    win.loadURL('http://127.0.0.1:5000');
    // win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('did-fail-load', () => {
    if (!app.isPackaged) {
      setTimeout(() => win.loadURL('http://127.0.0.1:5000'), 2000);
    }
  });
}

app.whenReady().then(() => {
  ensureDataDir();

  // The packaged Windows app can resume an active screen-control session
  // without showing a second picker. Capture the primary desktop only when
  // the renderer explicitly calls getDisplayMedia for an active share.
  if (typeof session?.defaultSession?.setDisplayMediaRequestHandler === 'function') {
    session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 1, height: 1 },
        });
        callback(sources[0] ? { video: sources[0] } : {});
      } catch {
        callback({});
      }
    });
  }

  createWindow();

  // Auto-start WhatsApp if a saved session exists — no re-scan needed
  const WA_DIR = path.join(DATA_DIR, 'whatsapp_session');
  const credsFile = path.join(WA_DIR, 'creds.json');
  if (fs.existsSync(credsFile)) {
    console.log('[WA] Saved session found — auto-starting WhatsApp client…');
    setTimeout(() => {
      initWhatsApp().catch(e => console.error('[WA] Auto-start failed:', e.message));
    }, 4000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
