-- One-time setup for the inflationdle-counter D1 database (already applied to production on 2026-09-26).
-- Local test: npx wrangler d1 execute inflationdle-counter --local --file worker/schema.sql
CREATE TABLE IF NOT EXISTS totals (id INTEGER PRIMARY KEY CHECK (id = 1), visitors INTEGER NOT NULL DEFAULT 0);
INSERT OR IGNORE INTO totals (id, visitors) VALUES (1, 0);
CREATE TABLE IF NOT EXISTS days (day TEXT PRIMARY KEY, visitors INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS salts (day TEXT PRIMARY KEY, salt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS seen (day TEXT NOT NULL, h TEXT NOT NULL, PRIMARY KEY (day, h)) WITHOUT ROWID;
-- Added 2026-09-29; the Worker also creates it on first use, so production needs no manual step.
CREATE TABLE IF NOT EXISTS refs (day TEXT NOT NULL, src TEXT NOT NULL, visitors INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, src));
