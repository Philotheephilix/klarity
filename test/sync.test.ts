import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  applyChangedFile,
  runIngestOnce,
  startIngestLoop,
  recordExceedsStringCap,
  MAX_STRING_BYTES,
  type SyncDeps,
} from '../src/sync.js';
import { descriptorHash } from '../src/hash.js';
import type { EntityRecord } from '../src/normalize/types.js';

// A minimal calldata descriptor with ONE deployment and TWO format keys, so a
// single normalize pass yields exactly two EntityRecords.
function twoRecordDescriptor() {
  return {
    $schema: 'https://eips.ethereum.org/assets/eip-7730/erc7730-v1.schema.json',
    context: {
      contract: {
        deployments: [{ chainId: 1, address: '0xAbCdEf0000000000000000000000000000000001' }],
      },
    },
    metadata: { owner: 'Aave' },
    display: {
      formats: {
        'transfer(address,uint256)': { intent: 'Transfer' },
        'approve(address,uint256)': { intent: 'Approve' },
      },
    },
  };
}

// Build a deps bundle with vi.fn mocks. getHashValues is a queue consumed in
// order by db.getHash so the loop-guard progression (null -> stored) is testable.
function makeDeps(opts: {
  content: Record<string, unknown>;
  getHashValues?: (string | null)[];
  queryManyRows?: Record<string, unknown>[];
}) {
  const getHashQueue = [...(opts.getHashValues ?? [null])];
  const github = {
    headSha: vi.fn(async () => 'HEAD_SHA'),
    changedDescriptors: vi.fn(async () => []),
    getFile: vi.fn(async () => ({ content: opts.content, sha: 'BLOB_SHA' })),
  };
  const arkiv = {
    upsert: vi.fn(async () => ({ entityKey: '0xkey', txHash: '0xtx', created: true })),
    remove: vi.fn(async () => ({ txHash: '0xtx' })),
    queryMany: vi.fn(async () => opts.queryManyRows ?? []),
  };
  const db = {
    getSyncCursor: vi.fn(() => null),
    setSyncCursor: vi.fn(),
    getHash: vi.fn(() => (getHashQueue.length > 0 ? getHashQueue.shift()! : null)),
    setHash: vi.fn(),
  };
  const deps = { github, arkiv, db } as unknown as SyncDeps;
  return { deps, github, arkiv, db };
}

describe('applyChangedFile — loop guard (brief case 1)', () => {
  it('writes first, skips the byte-identical second feed', async () => {
    const content = twoRecordDescriptor();
    const hash = descriptorHash(content);
    const path = 'registry/aave/calldata-Pool.json';

    // db.getHash returns null first (miss), then the stored hash (hit).
    const { deps, arkiv, db } = makeDeps({
      content,
      getHashValues: [null, hash],
    });

    const first = await applyChangedFile({ path, status: 'modified' }, deps);
    expect(first).toBe('written');
    // two format keys x one deployment => two upserts.
    expect(arkiv.upsert).toHaveBeenCalledTimes(2);
    expect(arkiv.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: 1 }),
      { source: 'github-sync', contentHash: hash },
    );
    expect(db.setHash).toHaveBeenCalledTimes(1);
    expect(db.setHash).toHaveBeenCalledWith(path, hash);

    arkiv.upsert.mockClear();

    const second = await applyChangedFile({ path, status: 'modified' }, deps);
    expect(second).toBe('skipped');
    expect(arkiv.upsert).not.toHaveBeenCalled();
  });
});

describe('applyChangedFile — removed (brief case 2)', () => {
  it('deletes by sourcePath-scoped query and removes each $key', async () => {
    const path = 'registry/aave/calldata-Pool.json';
    const rows = [
      { $key: '0xaaa0000000000000000000000000000000000000000000000000000000000001' },
      { $key: '0xbbb0000000000000000000000000000000000000000000000000000000000002' },
    ];
    const { deps, arkiv } = makeDeps({ content: {}, queryManyRows: rows });

    const outcome = await applyChangedFile({ path, status: 'removed' }, deps);

    expect(outcome).toBe('deleted');
    // The trust filter is inside ArkivClient.queryMany; asserting the
    // sourcePath-scoped query is the brief's "impostor excluded" check.
    expect(arkiv.queryMany).toHaveBeenCalledTimes(1);
    expect(arkiv.queryMany).toHaveBeenCalledWith({ sourcePath: path });
    expect(arkiv.remove).toHaveBeenCalledTimes(2);
    expect(arkiv.remove).toHaveBeenNthCalledWith(1, rows[0].$key);
    expect(arkiv.remove).toHaveBeenNthCalledWith(2, rows[1].$key);
  });

  it('returns deleted with zero rows (nothing to remove is still deleted)', async () => {
    const { deps, arkiv } = makeDeps({ content: {}, queryManyRows: [] });
    const outcome = await applyChangedFile(
      { path: 'registry/x/a.json', status: 'removed' },
      deps,
    );
    expect(outcome).toBe('deleted');
    expect(arkiv.remove).not.toHaveBeenCalled();
  });
});

describe('applyChangedFile — 128-byte string cap (guard 1)', () => {
  it('skips a record whose functionSignature exceeds 128 bytes without throwing', () => {
    const big = 'f'.repeat(MAX_STRING_BYTES + 1); // 129 ASCII bytes
    const rec = {
      chainId: 1,
      contract: '0xabc',
      selector: '0x12345678',
      functionName: 'f',
      functionSignature: big,
      kind: 'calldata',
      intent: '',
      entityName: '',
      contractName: '',
      owner: '',
      sourcePath: 'registry/x/a.json',
      schemaVersion: '',
      formatBlock: {},
    } as EntityRecord;
    expect(recordExceedsStringCap(rec)).toBe(true);

    const okRec = { ...rec, functionSignature: 'transfer(address,uint256)' };
    expect(recordExceedsStringCap(okRec)).toBe(false);
  });

  it('a descriptor with an oversized format key is skipped, upsert never called', async () => {
    // A calldata format key longer than 128 bytes => functionSignature oversized.
    const bigKey = `transfer(${'uint256,'.repeat(20)}uint256)`; // well over 128 bytes
    expect(new TextEncoder().encode(bigKey).length).toBeGreaterThan(MAX_STRING_BYTES);
    const content = {
      $schema: 'x',
      context: {
        contract: {
          deployments: [{ chainId: 1, address: '0x0000000000000000000000000000000000000001' }],
        },
      },
      display: { formats: { [bigKey]: { intent: 'Big' } } },
    };
    const { deps, arkiv, db } = makeDeps({ content, getHashValues: [null] });

    const outcome = await applyChangedFile(
      { path: 'registry/x/a.json', status: 'modified' },
      deps,
    );

    // The only record was oversized => dropped => no write => skipped,
    // hash NOT advanced so a future fix re-ingests.
    expect(outcome).toBe('skipped');
    expect(arkiv.upsert).not.toHaveBeenCalled();
    expect(db.setHash).not.toHaveBeenCalled();
  });
});

describe('applyChangedFile — good path (brief case / normal 2 records)', () => {
  it('upserts twice, setHash once, returns written', async () => {
    const content = twoRecordDescriptor();
    const hash = descriptorHash(content);
    const { deps, arkiv, db } = makeDeps({ content, getHashValues: [null] });

    const outcome = await applyChangedFile(
      { path: 'registry/aave/calldata-Pool.json', status: 'added' },
      deps,
    );

    expect(outcome).toBe('written');
    expect(arkiv.upsert).toHaveBeenCalledTimes(2);
    expect(db.setHash).toHaveBeenCalledTimes(1);
    expect(db.setHash).toHaveBeenCalledWith('registry/aave/calldata-Pool.json', hash);
  });
});

describe('runIngestOnce', () => {
  it('bootstraps from head when cursor is null, then advances cursor', async () => {
    const { deps, github, db } = makeDeps({ content: {} });
    // changedDescriptors default returns [] in the mock.
    const summary = await runIngestOnce(deps);

    expect(github.headSha).toHaveBeenCalledTimes(1);
    // Bootstrap: since === head, so changedDescriptors is called with head sha.
    expect(github.changedDescriptors).toHaveBeenCalledWith('HEAD_SHA');
    expect(db.setSyncCursor).toHaveBeenCalledWith('HEAD_SHA');
    expect(summary.files).toBe(0);
  });

  it('applies each changed file and rolls up counts', async () => {
    const content = twoRecordDescriptor();
    const { deps, github, db } = makeDeps({ content, getHashValues: [null] });
    db.getSyncCursor.mockReturnValue('OLD_CURSOR');
    github.changedDescriptors.mockResolvedValue([
      { path: 'registry/aave/calldata-Pool.json', status: 'added', sha: 'S1' },
    ]);

    const summary = await runIngestOnce(deps);

    expect(github.changedDescriptors).toHaveBeenCalledWith('OLD_CURSOR');
    // getFile reads at the compare head sha, not the old cursor.
    expect(github.getFile).toHaveBeenCalledWith('registry/aave/calldata-Pool.json', 'HEAD_SHA');
    expect(summary.files).toBe(1);
    expect(summary.written).toBe(1);
    expect(db.setSyncCursor).toHaveBeenCalledWith('HEAD_SHA');
  });
});

describe('startIngestLoop', () => {
  beforeEach(() => vi.useFakeTimers());

  it('schedules runIngestOnce on the interval and stop clears it', async () => {
    const { deps, github } = makeDeps({ content: {} });
    const stop = startIngestLoop(deps, 1000);
    expect(typeof stop).toBe('function');

    // Nothing runs inline.
    expect(github.headSha).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(github.headSha).toHaveBeenCalledTimes(1);

    stop();
    await vi.advanceTimersByTimeAsync(5000);
    // No further passes after stop.
    expect(github.headSha).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});
