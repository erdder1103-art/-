const express = require('express');
const fs = require('fs/promises');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;
const dataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
const stateFile = path.join(dataDir, 'state.json');
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

async function readState() {
  await ensureDataFile();
  try {
    const raw = await fs.readFile(stateFile, 'utf8');
    const data = JSON.parse(raw);
    return {
      expenses: Array.isArray(data.expenses) ? data.expenses : [],
      members: Array.isArray(data.members) ? data.members : [],
      rate: Number(data.rate) || 43,
      updated_at: data.updated_at || null
    };
  } catch {
    return { ...emptyState };
  }
}

async function writeState(data) {
  const safe = {
    expenses: Array.isArray(data.expenses) ? data.expenses.slice(0, 10000) : [],
    members: Array.isArray(data.members) ? data.members.slice(0, 100) : [],
    rate: Number(data.rate) || 43,
    updated_at: new Date().toISOString()
  };
  writeQueue = writeQueue.then(async () => {
    await ensureDataFile();
    const tempFile = `${stateFile}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(safe, null, 2), 'utf8');
    await fs.rename(tempFile, stateFile);
  });
  await writeQueue;
  return safe;
}


function normalizePin(value) {
  return String(value ?? '').trim();
}

async function sha256(value) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

app.post('/api/verify-pin', async (req, res) => {
  try {
    const memberId = String(req.body?.member_id || '');
    const pin = normalizePin(req.body?.pin);
    if (!memberId || !pin) return res.status(400).json({ ok: false });
    const state = await readState();
    const member = state.members.find(m => m.id === memberId);
    if (!member) return res.status(404).json({ ok: false });
    const adminPin = normalizePin(process.env.ADMIN_PIN || '0723');
    const memberOk = member.pin_hash && (await sha256(pin)) === member.pin_hash;
    const adminOk = pin === adminPin;
    if (!memberOk && !adminOk) return res.status(401).json({ ok: false });
    res.json({ ok: true, mode: adminOk ? 'admin' : 'member' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/state', async (_req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
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
  app.listen(port, '0.0.0.0', () => console.log(`Busan wallet running on port ${port}`));
});
