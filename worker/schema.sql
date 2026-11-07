-- Run once: npx wrangler d1 execute diggd --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS wallets (
  addr TEXT PRIMARY KEY,
  holds REAL NOT NULL DEFAULT 0,       -- $DIGGD balance, cached
  hold_checked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  hash TEXT PRIMARY KEY,      -- sha256 of the session key (the key itself is never stored)
  wallet TEXT NOT NULL,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS markets (
  token TEXT PRIMARY KEY,
  name TEXT,
  symbol TEXT,
  mcap REAL NOT NULL DEFAULT 0,
  creator TEXT,               -- Pons deployer
  stage TEXT,                 -- curve | graduated
  updated INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS bones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author TEXT NOT NULL,       -- sender of the bury transaction
  teaser TEXT NOT NULL,       -- public line shown while buried
  token TEXT,
  target REAL NOT NULL DEFAULT 0,      -- market cap in USD, 0 = none
  open_at INTEGER NOT NULL DEFAULT 0,  -- ms timestamp, 0 = none
  start_mcap REAL NOT NULL DEFAULT 0,
  commit_hash TEXT NOT NULL,  -- also written on-chain in the bury transaction's calldata
  sealed TEXT NOT NULL,       -- AES-GCM ciphertext of { salt, body }, base64
  iv TEXT NOT NULL,
  tx TEXT NOT NULL UNIQUE,
  by_creator INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'buried',   -- buried | dug
  hits INTEGER NOT NULL DEFAULT 0,         -- checks in a row at or above the target
  created INTEGER NOT NULL,
  dug_at INTEGER,
  dug_by TEXT,             -- mcap | date
  hidden INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS bones_by_status ON bones (status, dug_at);
CREATE INDEX IF NOT EXISTS bones_by_token ON bones (token);
CREATE INDEX IF NOT EXISTS bones_by_author ON bones (author);
