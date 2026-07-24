'use strict';

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { Pool } = require('pg');

const app = express();
const port = Number(process.env.PORT || 3000);
const databaseUrl = process.env.DATABASE_URL;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_MEMBER_STORAGE = 250 * 1024 * 1024;
const MAX_MEMBER_FILES = 200;

if (!databaseUrl) {
  console.error('DATABASE_URL is missing. Add a Railway PostgreSQL database to this project.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = /^(image\/(jpeg|png|webp|gif)|application\/pdf)$/i.test(file.mimetype);
    cb(ok ? null : new Error('unsupported_file_type'), ok);
  }
});

const EMPTY_STATE = { expenses: [], members: [], packing: [], rate: 43, trip_departure: '', updated_at: null, version: 0 };
const sessions = new Map();
let weatherCache = { data: null, expires: 0 };
setInterval(() => { const now = Date.now(); for (const [token, session] of sessions) if (session.expires < now) sessions.delete(token); }, 60 * 60 * 1000).unref();

app.disable('x-powered-by');
app.use(express.json({ limit: '3mb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], etag: true, maxAge: '5m' }));

function normalizePin(value) { return String(value ?? '').trim(); }
function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function safeName(value, fallback = '未命名') { return String(value || fallback).trim().slice(0, 120); }
function uuid() { return crypto.randomUUID(); }

function normalizeState(input) {
  const members = Array.isArray(input?.members) ? input.members.slice(0, 200) : [];
  const memberIds = new Set(members.map((item) => String(item?.id || '')).filter(Boolean));
  const expenses = Array.isArray(input?.expenses)
    ? input.expenses.filter((item) => item && memberIds.has(String(item.member_id || ''))).slice(0, 50000)
    : [];
  const packing = Array.isArray(input?.packing)
    ? input.packing.filter((item) => item && memberIds.has(String(item.member_id || ''))).slice(0, 20000)
    : [];
  const trip_departure = typeof input?.trip_departure === 'string' ? input.trip_departure.slice(0, 40) : '';
  return { members, expenses, packing, rate: Number(input?.rate) > 0 ? Number(input.rate) : 43, trip_departure };
}

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      payload JSONB NOT NULL DEFAULT '{"expenses":[],"members":[],"packing":[],"rate":43,"trip_departure":""}'::jsonb,
      version BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS travel_folders (
      id UUID PRIMARY KEY,
      member_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_travel_folders_member ON travel_folders(member_id);
    CREATE TABLE IF NOT EXISTS travel_documents (
      id UUID PRIMARY KEY,
      member_id TEXT NOT NULL,
      folder_id UUID REFERENCES travel_folders(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      travel_date DATE,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      file_data BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_travel_documents_member ON travel_documents(member_id);
    CREATE INDEX IF NOT EXISTS idx_travel_documents_folder ON travel_documents(folder_id);
  `);
  await pool.query(`INSERT INTO app_state (id, payload) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING`, [JSON.stringify({ expenses: [], members: [], packing: [], rate: 43, trip_departure: '' })]);
}

async function readState(client = pool) {
  const result = await client.query('SELECT payload, version, updated_at FROM app_state WHERE id = 1');
  if (!result.rows.length) return { ...EMPTY_STATE };
  const row = result.rows[0];
  return { ...normalizeState(row.payload || {}), version: Number(row.version || 0), updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null };
}

function mergeById(current, incoming, deletedIds = []) {
  const deleted = new Set((Array.isArray(deletedIds) ? deletedIds : []).map(String));
  const map = new Map((Array.isArray(current) ? current : []).map(item => [String(item.id), item]));
  for (const item of (Array.isArray(incoming) ? incoming : [])) {
    if (!item || !item.id || deleted.has(String(item.id))) continue;
    map.set(String(item.id), { ...(map.get(String(item.id)) || {}), ...item });
  }
  for (const id of deleted) map.delete(id);
  return [...map.values()];
}

async function writeState(input) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query('SELECT payload, version FROM app_state WHERE id = 1 FOR UPDATE');
    const currentSafe = normalizeState(locked.rows[0]?.payload || {});
    const incoming = normalizeState(input || {});
    const deleted = input?._deleted || {};
    const mergedMembers = mergeById(currentSafe.members, incoming.members, deleted.members);
    const validMemberIds = new Set(mergedMembers.map(m => String(m.id)));
    const mergedExpenses = mergeById(currentSafe.expenses, incoming.expenses, deleted.expenses).filter(x => validMemberIds.has(String(x.member_id || '')));
    const mergedPacking = mergeById(currentSafe.packing, incoming.packing, deleted.packing).filter(x => validMemberIds.has(String(x.member_id || '')));
    const merged = normalizeState({
      members: mergedMembers,
      expenses: mergedExpenses,
      packing: mergedPacking,
      rate: Number(input?.rate) > 0 ? Number(input.rate) : currentSafe.rate,
      trip_departure: typeof input?.trip_departure === 'string' ? input.trip_departure : currentSafe.trip_departure
    });
    const nextVersion = Number(locked.rows[0]?.version || 0) + 1;
    const result = await client.query(`UPDATE app_state SET payload=$1::jsonb, version=$2, updated_at=NOW() WHERE id=1 RETURNING payload,version,updated_at`, [JSON.stringify(merged), nextVersion]);
    const memberIds = merged.members.map(m => String(m.id));
    if (memberIds.length) {
      await client.query('DELETE FROM travel_documents WHERE NOT (member_id = ANY($1::text[]))', [memberIds]);
      await client.query('DELETE FROM travel_folders WHERE NOT (member_id = ANY($1::text[]))', [memberIds]);
    } else {
      await client.query('DELETE FROM travel_documents');
      await client.query('DELETE FROM travel_folders');
    }
    await client.query('COMMIT');
    const row = result.rows[0];
    return { ...normalizeState(row.payload), version: Number(row.version), updated_at: new Date(row.updated_at).toISOString() };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

async function verifyMember(memberId, pin) {
  const state = await readState();
  const member = state.members.find(item => String(item.id) === String(memberId));
  if (!member) return null;
  const adminPin = normalizePin(process.env.ADMIN_PIN || '0723');
  const cleanPin = normalizePin(pin);
  const noPin = !member.pin_hash;
  const memberOk = noPin || (cleanPin && sha256(cleanPin) === member.pin_hash);
  const adminOk = cleanPin && cleanPin === adminPin;
  return memberOk || adminOk ? { member, mode: adminOk ? 'admin' : 'member' } : null;
}

function issueSession(memberId, mode) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { memberId: String(memberId), mode, expires: Date.now() + 12 * 60 * 60 * 1000 });
  return token;
}

function authDocument(req, res, next) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7) : String(req.query.token || '');
  const session = sessions.get(token);
  if (!session || session.expires < Date.now()) {
    if (token) sessions.delete(token);
    return res.status(401).json({ error: 'document_access_required' });
  }
  req.documentSession = session;
  next();
}

function requireMember(req, res) {
  const requested = String(req.params.memberId || req.body?.member_id || req.query.member_id || '');
  if (!requested || requested !== req.documentSession.memberId) {
    res.status(403).json({ error: 'wrong_member' });
    return null;
  }
  return requested;
}

app.get('/api/health', async (_req, res) => {
  try {
    const state = await readState();
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, version: '8.8.1', storage: 'postgresql', persistent_storage: true, documents: true, members: state.members.length, expenses: state.expenses.length, state_version: state.version, updated_at: state.updated_at });
  } catch (error) { console.error(error); res.status(500).json({ ok: false, error: 'database_unavailable' }); }
});


app.get('/api/weather', async (req, res) => {
  try {
    const force = req.query.refresh === '1';
    if (!force && weatherCache.data && weatherCache.expires > Date.now()) {
      res.set('Cache-Control', 'no-store');
      return res.json({ ...weatherCache.data, cached: true });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=35.1796&longitude=129.0756&current=temperature_2m,apparent_temperature,relative_humidity_2m,is_day,weather_code,wind_speed_10m&hourly=temperature_2m,precipitation_probability,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FSeoul&forecast_days=7';
    let response;
    try { response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'BusanTripWallet/8.8.1' } }); } finally { clearTimeout(timeout); }
    if (!response.ok) throw new Error(`weather_http_${response.status}`);
    const data = await response.json();
    if (!data?.current || !Array.isArray(data?.hourly?.time) || !Array.isArray(data?.daily?.time)) throw new Error('weather_invalid_payload');
    weatherCache = { data, expires: Date.now() + 5 * 60 * 1000 };
    res.set('Cache-Control', 'no-store');
    res.json({ ...data, cached: false });
  } catch (error) {
    console.error('Weather proxy failed:', error.message);
    if (weatherCache.data) return res.status(200).json({ ...weatherCache.data, cached: true, stale: true });
    res.status(502).json({ error: 'weather_unavailable' });
  }
});

app.get('/api/state', async (_req, res) => {
  try { res.set('Cache-Control', 'no-store, no-cache, must-revalidate'); res.json(await readState()); }
  catch (error) { console.error(error); res.status(500).json({ error: 'read_failed' }); }
});

app.put('/api/state', async (req, res) => {
  try { res.set('Cache-Control', 'no-store'); res.json(await writeState(req.body || {})); }
  catch (error) { console.error(error); res.status(500).json({ error: 'write_failed' }); }
});

app.post('/api/verify-pin', async (req, res) => {
  try {
    const result = await verifyMember(req.body?.member_id, req.body?.pin);
    if (!result) return res.status(401).json({ ok: false });
    const token = issueSession(result.member.id, result.mode);
    res.json({ ok: true, mode: result.mode, token, expires_in: 43200 });
  } catch (error) { console.error(error); res.status(500).json({ ok: false }); }
});

app.post('/api/document-access', async (req, res) => {
  try {
    const result = await verifyMember(req.body?.member_id, req.body?.pin);
    if (!result) return res.status(401).json({ ok: false });
    const token = issueSession(result.member.id, result.mode);
    res.json({ ok: true, token, expires_in: 43200, mode: result.mode });
  } catch (error) { console.error(error); res.status(500).json({ ok: false }); }
});

app.get('/api/documents/:memberId/folders', authDocument, async (req, res) => {
  const memberId = requireMember(req, res); if (!memberId) return;
  const { rows } = await pool.query(`SELECT f.id,f.name,f.created_at,COUNT(d.id)::int AS file_count FROM travel_folders f LEFT JOIN travel_documents d ON d.folder_id=f.id WHERE f.member_id=$1 GROUP BY f.id ORDER BY f.created_at`, [memberId]);
  res.json(rows);
});

app.post('/api/documents/:memberId/folders', authDocument, async (req, res) => {
  const memberId = requireMember(req, res); if (!memberId) return;
  const name = safeName(req.body?.name, '新資料夾');
  const { rows } = await pool.query('INSERT INTO travel_folders(id,member_id,name) VALUES($1,$2,$3) RETURNING id,name,created_at', [uuid(), memberId, name]);
  res.status(201).json(rows[0]);
});

app.delete('/api/documents/:memberId/folders/:folderId', authDocument, async (req, res) => {
  const memberId = requireMember(req, res); if (!memberId) return;
  await pool.query('UPDATE travel_documents SET folder_id=NULL WHERE member_id=$1 AND folder_id=$2', [memberId, req.params.folderId]);
  const out = await pool.query('DELETE FROM travel_folders WHERE id=$1 AND member_id=$2', [req.params.folderId, memberId]);
  res.json({ ok: out.rowCount > 0 });
});

app.get('/api/documents/:memberId/files', authDocument, async (req, res) => {
  const memberId = requireMember(req, res); if (!memberId) return;
  const folderId = String(req.query.folder_id || '');
  const params = [memberId];
  let where = 'member_id=$1';
  if (folderId === '__root__') where += ' AND folder_id IS NULL';
  else if (folderId) { params.push(folderId); where += ' AND folder_id=$2'; }
  const { rows } = await pool.query(`SELECT id,folder_id,title,note,travel_date,original_name,mime_type,size_bytes,created_at FROM travel_documents WHERE ${where} ORDER BY created_at DESC`, params);
  res.json(rows);
});

app.post('/api/documents/:memberId/files', authDocument, upload.single('file'), async (req, res) => {
  const memberId = requireMember(req, res); if (!memberId) return;
  if (!req.file) return res.status(400).json({ error: 'file_required' });
  const usage = await pool.query('SELECT COUNT(*)::int count,COALESCE(SUM(size_bytes),0)::bigint bytes FROM travel_documents WHERE member_id=$1', [memberId]);
  const count = Number(usage.rows[0].count); const bytes = Number(usage.rows[0].bytes);
  if (count >= MAX_MEMBER_FILES) return res.status(413).json({ error: 'file_count_limit' });
  if (bytes + req.file.size > MAX_MEMBER_STORAGE) return res.status(413).json({ error: 'storage_limit' });
  const folderId = req.body.folder_id || null;
  if (folderId) {
    const folder = await pool.query('SELECT 1 FROM travel_folders WHERE id=$1 AND member_id=$2', [folderId, memberId]);
    if (!folder.rowCount) return res.status(400).json({ error: 'invalid_folder' });
  }
  const id = uuid();
  const title = safeName(req.body.title, req.file.originalname);
  const note = String(req.body.note || '').trim().slice(0, 1000);
  const travelDate = req.body.travel_date || null;
  await pool.query(`INSERT INTO travel_documents(id,member_id,folder_id,title,note,travel_date,original_name,mime_type,size_bytes,file_data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id, memberId, folderId, title, note, travelDate, safeName(req.file.originalname), req.file.mimetype, req.file.size, req.file.buffer]);
  res.status(201).json({ ok: true, id });
});

app.get('/api/documents/:memberId/files/:fileId/content', authDocument, async (req, res) => {
  const memberId = requireMember(req, res); if (!memberId) return;
  const { rows } = await pool.query('SELECT original_name,mime_type,size_bytes,file_data FROM travel_documents WHERE id=$1 AND member_id=$2', [req.params.fileId, memberId]);
  if (!rows.length) return res.status(404).end();
  const f = rows[0];
  res.set('Content-Type', f.mime_type); res.set('Content-Length', String(f.size_bytes)); res.set('Cache-Control', 'private, max-age=300');
  res.set('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(f.original_name)}`);
  res.send(f.file_data);
});

app.delete('/api/documents/:memberId/files/:fileId', authDocument, async (req, res) => {
  const memberId = requireMember(req, res); if (!memberId) return;
  const out = await pool.query('DELETE FROM travel_documents WHERE id=$1 AND member_id=$2', [req.params.fileId, memberId]);
  res.json({ ok: out.rowCount > 0 });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'file_too_large', max_mb: 15 });
  if (error?.message === 'unsupported_file_type') return res.status(415).json({ error: 'unsupported_file_type' });
  res.status(500).json({ error: 'server_error' });
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

initializeDatabase().then(() => app.listen(port, '0.0.0.0', () => console.log(`Busan Trip Wallet V8.8.0 running on port ${port}`))).catch(error => { console.error('Database initialization failed:', error); process.exit(1); });
async function shutdown(signal) { console.log(`${signal} received`); await pool.end().catch(() => {}); process.exit(0); }
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
