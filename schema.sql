CREATE TABLE IF NOT EXISTS shared_wallet (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  expenses TEXT NOT NULL DEFAULT '[]',
  members TEXT NOT NULL DEFAULT '[]',
  rate REAL NOT NULL DEFAULT 43,
  updated_at TEXT
);
INSERT OR IGNORE INTO shared_wallet (id, expenses, members, rate, updated_at)
VALUES (1, '[]', '[]', 43, NULL);
