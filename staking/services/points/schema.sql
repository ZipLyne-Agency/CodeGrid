-- GRID seasonal points — D1 schema.
--
-- Points are a NON-FINANCIAL status/leaderboard signal. They are NEVER
-- convertible to $GRID or any token (see /token/policy). Accrual = real
-- CodeGrid usage × a gentle veGRID-power multiplier.

CREATE TABLE IF NOT EXISTS seasons (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  started_at  INTEGER NOT NULL,   -- unix seconds
  ends_at     INTEGER,            -- null = open-ended
  active      INTEGER NOT NULL DEFAULT 1
);

-- Running point total per address per season.
CREATE TABLE IF NOT EXISTS points (
  address     TEXT NOT NULL,      -- checksummed 0x address
  season_id   INTEGER NOT NULL,
  points      REAL NOT NULL DEFAULT 0,
  usage_units REAL NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (address, season_id),
  FOREIGN KEY (season_id) REFERENCES seasons(id)
);

CREATE INDEX IF NOT EXISTS idx_points_leaderboard
  ON points (season_id, points DESC);

-- Append-only heartbeat ledger (audit + anti-abuse rate limiting).
CREATE TABLE IF NOT EXISTS heartbeats (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  address     TEXT NOT NULL,
  season_id   INTEGER NOT NULL,
  ts          INTEGER NOT NULL,
  usage_units REAL NOT NULL,
  power       TEXT NOT NULL,      -- veGRID power at time of beat (wei string)
  awarded     REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_heartbeats_addr_ts
  ON heartbeats (address, ts DESC);

-- Seed an opening season if none exists.
INSERT INTO seasons (name, started_at, active)
SELECT 'Season 1', strftime('%s','now'), 1
WHERE NOT EXISTS (SELECT 1 FROM seasons WHERE active = 1);
