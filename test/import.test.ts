import { describe, it, expect, vi } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runImport, walkDescriptors, type ImportDeps } from '../src/import.js';
import { openDb } from '../src/db.js';
import {
  normalizeDescriptor,
  type EntityRecord,
} from '../src/normalize/normalize.js';
import type { LoadFragment } from '../src/normalize/includes.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures', 'import');

// A loadFragment identical to the one runImport uses internally — used here
// only to independently compute the EXPECTED record count per fixture.
const loadFragment: LoadFragment = (relPath, fromPath) =>
  JSON.parse(readFileSync(join(dirname(fromPath), relPath), 'utf8')) as Record<
    string,
    unknown
  >;

/** Count the records each walked fixture yields (includes resolved). */
function expectedRecords(): { total: number; perFile: Map<string, number> } {
  const perFile = new Map<string, number>();
  let total = 0;
  for (const absPath of walkDescriptors(FIXTURES)) {
    const content = JSON.parse(readFileSync(absPath, 'utf8')) as Record<
      string,
      unknown
    >;
    const recs = normalizeDescriptor(content, absPath, {
      loadFragment,
      fromPath: absPath,
    });
    perFile.set(absPath, recs.length);
    total += recs.length;
  }
  return { total, perFile };
}

function makeDeps(): {
  deps: ImportDeps;
  upsert: ReturnType<typeof vi.fn>;
  setHash: ReturnType<typeof vi.fn>;
  upsertedRecords: EntityRecord[];
} {
  const db = openDb(':memory:');
  const setHash = vi.fn((path: string, hash: string) => db.setHash(path, hash));
  const upsertedRecords: EntityRecord[] = [];
  const upsert = vi.fn(async (rec: EntityRecord) => {
    upsertedRecords.push(rec);
    return { entityKey: '0xkey', txHash: '0xtx', created: true };
  });
  const deps: ImportDeps = {
    arkiv: { upsert } as unknown as ImportDeps['arkiv'],
    // Wrap the real in-memory Db so the loop guard genuinely round-trips
    // through SQLite, while still letting us spy on setHash.
    db: {
      getHash: (p: string) => db.getHash(p),
      setHash,
      setSyncCursor: (sha: string) => db.setSyncCursor(sha),
    },
  };
  return { deps, upsert, setHash, upsertedRecords };
}

describe('walkDescriptors', () => {
  it('excludes tests dirs, *.tests.json, and common-*.json fragments', () => {
    const files = walkDescriptors(FIXTURES).map((p) => p.split('/').pop());
    expect(files).toContain('celo-noarg.json');
    expect(files).toContain('aave-calldata-multideploy.json');
    expect(files).toContain('dai-permit-includes.json');
    // excluded:
    expect(files).not.toContain('common-dai-permit.json');
    expect(files).not.toContain('celo-noarg.tests.json');
    expect(files).not.toContain('should-be-excluded.json');
    // exactly the three emit descriptors
    expect(files).toHaveLength(3);
  });
});

describe('runImport({root}) — backfill', () => {
  it('upserts every record across fixtures, resolving includes, and writes a hash per source path', async () => {
    const { deps, upsert, setHash, upsertedRecords } = makeDeps();
    const { total, perFile } = expectedRecords();

    const summary = await runImport({ root: FIXTURES }, deps);

    // Every emit descriptor was written (none failed/skipped on a fresh DB).
    expect(summary.files).toBe(3);
    expect(summary.upserted).toBe(3);
    expect(summary.skipped).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.records).toBe(total);
    expect(upsert).toHaveBeenCalledTimes(total);

    // One setHash per written source path.
    expect(setHash).toHaveBeenCalledTimes(3);

    // INCLUDES RESOLVED: the include-bearing dai-permit descriptor produced its
    // record(s) (did NOT throw/skip). Its format lives ONLY in the fragment.
    const daiPath = [...perFile.keys()].find((p) => p.endsWith('dai-permit-includes.json'))!;
    expect(perFile.get(daiPath)).toBeGreaterThan(0);
    const daiRecords = upsertedRecords.filter((r) =>
      r.sourcePath.endsWith('dai-permit-includes.json'),
    );
    expect(daiRecords.length).toBe(perFile.get(daiPath));

    // Prove the MERGE happened, not just "didn't throw": the Permit primary
    // type exists only in common-dai-permit.json, never in the including file.
    const includingFile = JSON.parse(
      readFileSync(join(FIXTURES, 'dai-permit-includes.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(JSON.stringify(includingFile)).not.toContain('Permit(address holder');
    expect(daiRecords.length).toBeGreaterThan(0);
    expect(daiRecords[0]!.functionSignature).toContain('Permit(address holder');
    expect(daiRecords[0]!.kind).toBe('eip712');
  });

  it('a second run over unchanged fixtures is all skipped — upsert not called again', async () => {
    const { deps, upsert, setHash } = makeDeps();
    const { total } = expectedRecords();

    const first = await runImport({ root: FIXTURES }, deps);
    expect(first.upserted).toBe(3);
    expect(upsert).toHaveBeenCalledTimes(total);
    const callsAfterFirst = upsert.mock.calls.length;
    const setHashAfterFirst = setHash.mock.calls.length;

    const second = await runImport({ root: FIXTURES }, deps);
    expect(second.skipped).toBe(second.files);
    expect(second.skipped).toBe(3);
    expect(second.upserted).toBe(0);
    expect(second.records).toBe(0);
    // upsert and setHash NOT invoked again on the no-op re-run.
    expect(upsert.mock.calls.length).toBe(callsAfterFirst);
    expect(setHash.mock.calls.length).toBe(setHashAfterFirst);
  });

  it('parks the sync cursor at the github head when a github dep is supplied', async () => {
    const { deps } = makeDeps();
    const setSyncCursor = vi.fn();
    const depsWithGh: ImportDeps = {
      ...deps,
      db: { ...deps.db, setSyncCursor },
      github: { headSha: vi.fn(async () => 'HEAD_SHA_123') },
    };
    await runImport({ root: FIXTURES }, depsWithGh);
    expect(setSyncCursor).toHaveBeenCalledWith('HEAD_SHA_123');
  });
});

describe('runImport({root}) — over-cap string field is written, not dropped', () => {
  it('upserts a record whose format key exceeds the 128-byte str cap', async () => {
    // Task 1's toValues omits the offending str column per-field, so a record
    // with an oversized functionName/functionSignature is now UPSERTED rather
    // than the whole record being dropped at the writer layer.
    const root = mkdtempSync(join(tmpdir(), 'import-overcap-'));
    const bigKey = `transfer(${'uint256,'.repeat(20)}uint256)`; // well over 128 bytes
    expect(new TextEncoder().encode(bigKey).length).toBeGreaterThan(128);
    const content = {
      $schema: 'x',
      context: {
        contract: {
          deployments: [
            { chainId: 1, address: '0x0000000000000000000000000000000000000001' },
          ],
        },
      },
      display: { formats: { [bigKey]: { intent: 'Big' } } },
    };
    writeFileSync(join(root, 'overcap.json'), JSON.stringify(content));

    const { deps, upsert, setHash } = makeDeps();
    const summary = await runImport({ root }, deps);

    // The record is no longer dropped: it is upserted and the file is counted
    // as upserted, not skipped.
    expect(summary.files).toBe(1);
    expect(summary.upserted).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(summary.records).toBe(1);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(setHash).toHaveBeenCalledTimes(1);
  });
});

describe('runImport({fromGitHub})', () => {
  it('is a documented, loud stub (no silent partial data)', async () => {
    const { deps } = makeDeps();
    await expect(runImport({ fromGitHub: true }, deps)).rejects.toThrow(
      /not implemented in T10/,
    );
  });
});
