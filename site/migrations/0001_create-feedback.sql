-- Adopt the feedback table that predates Goribu's migration runner. Existing
-- production rows must survive, so this migration is idempotent and deliberately
-- has no down SQL: dropping the table would not restore those rows.

-- migrate:up
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- migrate:down
