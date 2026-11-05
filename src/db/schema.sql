-- Klarity sync-state store. Pure local persistence, no network.

-- Single-row key/value for sync cursor (last-synced upstream commit SHA).
CREATE TABLE IF NOT EXISTS sync_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- EIP-712 replay guard: a (signer, nonce) pair may only ever be used once.
CREATE TABLE IF NOT EXISTS used_nonces (
  signer TEXT NOT NULL,
  nonce  TEXT NOT NULL,
  PRIMARY KEY (signer, nonce)
);

-- Loop guard: per-descriptor-file content hash (descriptorHash values).
CREATE TABLE IF NOT EXISTS source_hashes (
  source_path TEXT PRIMARY KEY,
  hash        TEXT NOT NULL
);

-- Webhook delivery-id dedupe.
CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY
);
