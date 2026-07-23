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
