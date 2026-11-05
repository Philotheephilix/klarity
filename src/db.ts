import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';

const SYNC_CURSOR_KEY = 'sync_cursor';

export interface Db {
  getSyncCursor(): string | null;
  setSyncCursor(sha: string): void;
  isNonceUsed(signer: string, nonce: string): boolean;
  markNonceUsed(signer: string, nonce: string): boolean;
  getHash(sourcePath: string): string | null;
  setHash(sourcePath: string, hash: string): void;
  wasDelivery(id: string): boolean;
  markDelivery(id: string): void;
}

function loadSchema(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(join(here, 'db', 'schema.sql'), 'utf8');
}

/**
 * Open (or create) the local sync-state store at `path`. Pass `:memory:` for an
 * ephemeral in-memory DB. Executes the DDL in `src/db/schema.sql` on open.
 */
export function openDb(path: string): Db {
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.exec(loadSchema());

  const selCursor = sqlite.prepare(
    'SELECT value FROM sync_state WHERE key = ?'
  );
  const upCursor = sqlite.prepare(
    'INSERT INTO sync_state (key, value) VALUES (?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );

  const selNonce = sqlite.prepare(
    'SELECT 1 FROM used_nonces WHERE signer = ? AND nonce = ?'
  );
  const insNonce = sqlite.prepare(
    'INSERT OR IGNORE INTO used_nonces (signer, nonce) VALUES (?, ?)'
  );

  const selHash = sqlite.prepare(
    'SELECT hash FROM source_hashes WHERE source_path = ?'
  );
  const upHash = sqlite.prepare(
    'INSERT INTO source_hashes (source_path, hash) VALUES (?, ?) ' +
      'ON CONFLICT(source_path) DO UPDATE SET hash = excluded.hash'
  );

  const selDelivery = sqlite.prepare('SELECT 1 FROM deliveries WHERE id = ?');
  const insDelivery = sqlite.prepare(
    'INSERT OR IGNORE INTO deliveries (id) VALUES (?)'
  );

  return {
    getSyncCursor(): string | null {
      const row = selCursor.get(SYNC_CURSOR_KEY) as
        | { value: string }
        | undefined;
      return row ? row.value : null;
    },
    setSyncCursor(sha: string): void {
      upCursor.run(SYNC_CURSOR_KEY, sha);
    },
    isNonceUsed(signer: string, nonce: string): boolean {
      return selNonce.get(signer, nonce) !== undefined;
    },
    markNonceUsed(signer: string, nonce: string): boolean {
      // INSERT OR IGNORE: changes === 0 means the pair already existed.
      const info = insNonce.run(signer, nonce);
      return info.changes > 0;
    },
    getHash(sourcePath: string): string | null {
      const row = selHash.get(sourcePath) as { hash: string } | undefined;
      return row ? row.hash : null;
    },
    setHash(sourcePath: string, hash: string): void {
      upHash.run(sourcePath, hash);
    },
    wasDelivery(id: string): boolean {
      return selDelivery.get(id) !== undefined;
    },
    markDelivery(id: string): void {
      insDelivery.run(id);
    },
  };
}
