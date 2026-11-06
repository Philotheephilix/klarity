import { describe, it, expect } from 'vitest';
import {
  putPending,
  listPending,
  removePending,
  markAttempted,
  type PendingVouch,
  type PendingState,
  type StateDeps,
} from '../src/pending.js';

/**
 * Build an in-memory {@link StateDeps} stub: a closure over a mutable
 * `PendingState`. `get` starts from `undefined` to exercise the first-run
 * empty-state normalization; `set` replaces the backing object wholesale,
 * mirroring `snap_manage_state`'s replace semantics.
 */
function memoryDeps(initial?: PendingState | null): {
  deps: StateDeps;
  raw: () => PendingState | null | undefined;
} {
  let store: PendingState | null | undefined = initial;
  return {
    deps: {
      get: async () => store,
      set: async (s: PendingState) => {
        store = s;
      },
    },
    raw: () => store,
  };
}

function makeVouch(overrides: Partial<PendingVouch> = {}): PendingVouch {
  return {
    chainId: 1,
    contract: '0xcontract',
    selector: '0xa9059cbb',
    interactionTxHash: '0xtx',
    account: '0xacct',
    rating: 5,
    comment: 'did exactly what it said',
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('pending-vouch store', () => {
  it('putPending then listPending returns the vouch', async () => {
    const { deps } = memoryDeps();
    const v = makeVouch();
    await putPending(deps, v);
    const list = await listPending(deps);
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual(v);
  });

  it('putPending twice with same interactionTxHash stores ONE entry', async () => {
    const { deps } = memoryDeps();
    await putPending(deps, makeVouch({ rating: 3 }));
    await putPending(deps, makeVouch({ rating: 5 }));
    const list = await listPending(deps);
    expect(list).toHaveLength(1);
    expect(list[0].rating).toBe(5);
  });

  it('removePending deletes that key', async () => {
    const { deps } = memoryDeps();
    await putPending(deps, makeVouch({ interactionTxHash: '0xa' }));
    await putPending(deps, makeVouch({ interactionTxHash: '0xb' }));
    await removePending(deps, '0xa');
    const list = await listPending(deps);
    expect(list).toHaveLength(1);
    expect(list[0].interactionTxHash).toBe('0xb');
  });

  it('markAttempted sets attemptedUid on that entry', async () => {
    const { deps } = memoryDeps();
    await putPending(deps, makeVouch({ interactionTxHash: '0xa' }));
    await markAttempted(deps, '0xa', '0xuid');
    const list = await listPending(deps);
    expect(list[0].attemptedUid).toBe('0xuid');
  });

  it('markAttempted is a no-op when the key is missing', async () => {
    const { deps } = memoryDeps();
    await markAttempted(deps, '0xmissing', '0xuid');
    const list = await listPending(deps);
    expect(list).toHaveLength(0);
  });

  it('listPending on fresh/empty state returns []', async () => {
    const { deps } = memoryDeps();
    expect(await listPending(deps)).toEqual([]);

    const emptyObj = memoryDeps({} as unknown as PendingState);
    expect(await listPending(emptyObj.deps)).toEqual([]);

    const nullState = memoryDeps(null);
    expect(await listPending(nullState.deps)).toEqual([]);
  });
});
