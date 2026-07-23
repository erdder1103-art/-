const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 3000;

// Railway Volume 掛載後會自動提供 RAILWAY_VOLUME_MOUNT_PATH。
// Railway 正式環境絕不再把資料寫進程式目錄，避免每次部署被清空。
const isRailway = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
const dataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || (isRailway ? '/data' : path.join(__dirname, 'data'));
const stateFile = path.join(dataDir, 'state.json');
const backupFile = path.join(dataDir, 'state.backup.json');
const emptyState = { expenses: [], members: [], rate: 43, updated_at: null };
let writeQueue = Promise.resolve();

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

async function ensureDataFile() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(stateFile);
  } catch {
    await fs.writeFile(stateFile, JSON.stringify(emptyState, null, 2), 'utf8');
  }
}

function normalizeState(data) {
  return {
    expenses: Array.isArray(data?.expenses) ? data.expenses.slice(0, 10000) : [],
    members: Array.isArray(data?.members) ? data.members.slice(0, 100) : [],
    rate: Number(data?.rate) || 43,
    updated_at: data?.updated_at || null
  };
}

async function readState() {
  await ensureDataFile();
  try {
    const raw = await fs.readFile(stateFile, 'utf8');
    return normalizeState(JSON.parse(raw));
  } catch (error) {
    console.error('Primary state read failed:', error);
    try {
      const raw = await fs.readFile(backupFile, 'utf8');
      return normalizeState(JSON.parse(raw));
    } catch {
      return { ...emptyState };
    }
  }
}

async function writeState(data) {
  const safe = normalizeState({ ...data, updated_at: new Date().toISOString() });
  safe.updated_at = new Date().toISOString();

  writeQueue = writeQueue.then(async () => {
    await ensureDataFile();
    try {
      await fs.copyFile(stateFile, backupFile);
    } catch {}

    const tempFile = path.join(dataDir, `state-${process.pid}.tmp`);
    await fs.writeFile(tempFile, JSON.stringify(safe, null, 2), 'utf8');
    await fs.rename(tempFile, stateFile);
  });

  await writeQueue;
  return safe;
}

function normalizePin(value) {
  return String(value ?? '').trim();
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

app.post('/api/verify-pin', async (req, res) => {
  try {
    const memberId = String(req.body?.member_id || '');
    const pin = normalizePin(req.body?.pin);
    if (!memberId || !pin) return res.status(400).json({ ok: false });

    const state = await readState();
    const member = state.members.find((item) => item.id === memberId);
    if (!member) return res.status(404).json({ ok: false });

    const adminPin = normalizePin(process.env.ADMIN_PIN || '0723');
    const memberOk = Boolean(member.pin_hash) && sha256(pin) === member.pin_hash;
    const adminOk = pin === adminPin;

    if (!memberOk && !adminOk) return res.status(401).json({ ok: false });
    res.json({ ok: true, mode: adminOk ? 'admin' : 'member' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false });
  }
});

app.get('/api/health', async (_req, res) => {
  try {
    const state = await readState();
    res.json({
      ok: true,
      persistent_storage: Boolean(process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || isRailway),
      storage_path: dataDir,
      members: state.members.length,
      expenses: state.expenses.length,
      updated_at: state.updated_at
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/state', async (_req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json(await readState());
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'read_failed' });
  }
});

app.put('/api/state', async (req, res) => {
  try {
    res.json(await writeState(req.body || {}));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'write_failed' });
  }
});

app.use((_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

ensureDataFile().then(() => {
  console.log(`Persistent storage path: ${dataDir}`);
  console.log(`State file: ${stateFile}`);
  app.listen(port, '0.0.0.0', () => console.log(`Busan wallet running on port ${port}`));
}).catch((error) => {
  console.error('Failed to initialize persistent storage:', error);
  process.exit(1);
});
