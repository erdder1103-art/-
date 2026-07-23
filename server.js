'use strict';

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const port = Number(process.env.PORT || 3000);
const databaseUrl = process.env.DATABASE_URL;

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

const EMPTY_STATE = {
  expenses: [],
  members: [],
  rate: 43,
  updated_at: null,
  version: 0
};

app.disable('x-powered-by');
app.use(express.json({ limit: '3mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  etag: true,
  maxAge: '5m'
}));

function normalizePin(value) {
  return String(value ?? '').trim();
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function normalizeState(input) {
  const members = Array.isArray(input?.members) ? input.members.slice(0, 200) : [];
  const memberIds = new Set(members.map((item) => String(item?.id || '')).filter(Boolean));
  const expenses = Array.isArray(input?.expenses)
    ? input.expenses
        .filter((item) => item && memberIds.has(String(item.member_id || '')))
        .slice(0, 50000)
    : [];

  return {
    members,
    expenses,
    rate: Number(input?.rate) > 0 ? Number(input.rate) : 43
  };
}

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      payload JSONB NOT NULL DEFAULT '{"expenses":[],"members":[],"rate":43}'::jsonb,
      version BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    INSERT INTO app_state (id, payload)
    VALUES (1, $1::jsonb)
    ON CONFLICT (id) DO NOTHING
  `, [JSON.stringify({ expenses: [], members: [], rate: 43 })]);
}

async function readState(client = pool) {
  const result = await client.query(
    'SELECT payload, version, updated_at FROM app_state WHERE id = 1'
  );

  if (!result.rows.length) return { ...EMPTY_STATE };
  const row = result.rows[0];
  const state = normalizeState(row.payload || {});
  return {
    ...state,
    version: Number(row.version || 0),
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null
  };
}

async function writeState(input) {
  const safe = normalizeState(input || {});
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const current = await client.query(
      'SELECT version FROM app_state WHERE id = 1 FOR UPDATE'
    );
    const nextVersion = Number(current.rows[0]?.version || 0) + 1;

    const result = await client.query(`
      UPDATE app_state
      SET payload = $1::jsonb,
          version = $2,
          updated_at = NOW()
      WHERE id = 1
      RETURNING payload, version, updated_at
    `, [JSON.stringify(safe), nextVersion]);

    await client.query('COMMIT');
    const row = result.rows[0];
    return {
      ...normalizeState(row.payload),
      version: Number(row.version),
      updated_at: new Date(row.updated_at).toISOString()
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

app.get('/api/health', async (_req, res) => {
  try {
    const state = await readState();
    res.set('Cache-Control', 'no-store');
    res.json({
      ok: true,
      version: '8.0.0',
      storage: 'postgresql',
      persistent_storage: true,
      members: state.members.length,
      expenses: state.expenses.length,
      state_version: state.version,
      updated_at: state.updated_at
    });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({ ok: false, error: 'database_unavailable' });
  }
});

app.get('/api/state', async (_req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json(await readState());
  } catch (error) {
    console.error('Read state failed:', error);
    res.status(500).json({ error: 'read_failed' });
  }
});

app.put('/api/state', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await writeState(req.body || {}));
  } catch (error) {
    console.error('Write state failed:', error);
    res.status(500).json({ error: 'write_failed' });
  }
});

app.post('/api/verify-pin', async (req, res) => {
  try {
    const memberId = String(req.body?.member_id || '').trim();
    const pin = normalizePin(req.body?.pin);
    if (!memberId || !pin) return res.status(400).json({ ok: false });

    const state = await readState();
    const member = state.members.find((item) => String(item.id) === memberId);
    if (!member) return res.status(404).json({ ok: false });

    const adminPin = normalizePin(process.env.ADMIN_PIN || '0723');
    const memberOk = Boolean(member.pin_hash) && sha256(pin) === member.pin_hash;
    const adminOk = pin === adminPin;

    if (!memberOk && !adminOk) return res.status(401).json({ ok: false });
    return res.json({ ok: true, mode: adminOk ? 'admin' : 'member' });
  } catch (error) {
    console.error('PIN verification failed:', error);
    return res.status(500).json({ ok: false });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initializeDatabase()
  .then(() => {
    app.listen(port, '0.0.0.0', () => {
      console.log(`Busan Trip Wallet V8 running on port ${port}`);
      console.log('Persistent storage: Railway PostgreSQL');
    });
  })
  .catch((error) => {
    console.error('Database initialization failed:', error);
    process.exit(1);
  });

async function shutdown(signal) {
  console.log(`${signal} received, closing database pool.`);
  await pool.end().catch(() => {});
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
