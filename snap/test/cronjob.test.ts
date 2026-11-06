import { describe, it, expect, vi } from 'vitest';
import { KlarityAttester, MAINNET } from '@klarity/sdk';
import type { EasProfile } from '@klarity/sdk';

import {
  captureVouch,
  pollPending,
  POLL_METHOD,
  MAX_PENDING_AGE_MS,
  type CaptureVouchDeps,
  type PollPendingDeps,
} from '../src/index.js';
import type { PendingVouch, PendingState, StateDeps } from '../src/pending.js';
import { listPending } from '../src/pending.js';
import { UserInputEventType } from '@metamask/snaps-sdk';

const CONTRACT = '0xd01607c3c5ecaba394d8be377a08590149325722';
const ACCOUNT = '0x00000000000000000000000000000000000000a1';
const SELECTOR = '0x04f04769';
const TX_MINED = '0x' + 'cc'.repeat(32);
const TX_UNMINED = '0x' + 'ab'.repeat(32);
const TX_REVERTED = '0x' + 'ee'.repeat(32);
const REGISTERED_UID = '0x' + '77'.repeat(32);
const RESULT_UID = '0x' + '11'.repeat(32);

/** In-memory StateDeps seeded with the given pending vouches. */
function memoryState(seed: PendingVouch[] = []): StateDeps & {
  snapshot: () => PendingState;
} {
  const record: Record<string, PendingVouch> = {};
  for (const v of seed) {
    record[v.interactionTxHash] = v;
  }
  let state: PendingState = { pending: record };
  return {
    get: async () => state,
    set: async (s: PendingState) => {
      state = s;
    },
    snapshot: () => state,
  };
}

/** A pending vouch with sensible defaults, overridable per-field. */
function pendingVouch(over: Partial<PendingVouch> = {}): PendingVouch {
  return {
    chainId: 1,
    contract: CONTRACT,
    selector: SELECTOR,
    interactionTxHash: TX_MINED,
    account: ACCOUNT,
    rating: 5,
    comment: 'did what it said',
    createdAt: 1000,
    ...over,
  };
}

/**
 * A getReceipt that returns a mined receipt (status 1) for `mined`, a reverted
 * receipt (status '0x0') for `reverted`, and null (unmined) for everything else.
 */
function fakeGetReceipt(opts: {
  mined?: Set<string>;
  reverted?: Set<string>;
}): (hash: string) => Promise<{ status?: string | null } | null> {
  return async (hash: string) => {
    if (opts.reverted?.has(hash)) return { status: '0x0' };
    if (opts.mined?.has(hash)) return { status: '0x1' };
    return null;
  };
}

/**
 * A provider wired so verifyInteraction passes for `mined` (to==contract,
 * from==account, status 1) and fails for `reverted` (status 0x0).
 */
function fakeProvider(opts: { mined?: Set<string>; reverted?: Set<string> }) {
  return {
    async getTransaction(hash: string) {
      if (opts.mined?.has(hash) || opts.reverted?.has(hash)) {
        return { to: CONTRACT, from: ACCOUNT };
      }
      return null;
    },
    async getTransactionReceipt(hash: string) {
      if (opts.reverted?.has(hash)) return { status: '0x0' };
      if (opts.mined?.has(hash)) return { status: '0x1' };
      return null;
    },
  };
}

const profileWith = (publicSchemaUID: string): EasProfile => ({
  ...MAINNET,
  publicSchemaUID,
});

/** Build pollPending deps with overridable seams. */
function pollDeps(over: Partial<PollPendingDeps> & { state: StateDeps }): PollPendingDeps {
  const profile = over.profile ?? profileWith(REGISTERED_UID);
  return {
    state: over.state,
    getReceipt:
      over.getReceipt ?? fakeGetReceipt({ mined: new Set([TX_MINED]) }),
    attester:
      over.attester ??
      (new KlarityAttester({ profile }) as unknown as KlarityAttester),
    provider: over.provider ?? fakeProvider({ mined: new Set([TX_MINED]) }),
    profile,
    now: over.now ?? (() => 2000),
    waitOpts: over.waitOpts ?? { intervalMs: 0, maxTries: 1 },
  };
}

describe('pollPending (onCronjob core)', () => {
  it('(a) mined + valid + registered UID -> submits (attestPublic reached) then removes', async () => {
    const profile = profileWith(REGISTERED_UID);
    let attestReached = false;
    const attester = new KlarityAttester({ profile });
    (attester as unknown as { attestPublic: () => Promise<string> }).attestPublic =
      async () => {
        attestReached = true;
        return RESULT_UID;
      };
    const state = memoryState([pendingVouch({ interactionTxHash: TX_MINED })]);

    await pollPending(
      pollDeps({
        state,
        profile,
        attester: attester as unknown as KlarityAttester,
        provider: fakeProvider({ mined: new Set([TX_MINED]) }),
        getReceipt: fakeGetReceipt({ mined: new Set([TX_MINED]) }),
      }),
    );

    expect(attestReached).toBe(true);
    // Entry removed after a successful submit (markAttempted then removePending).
    expect(await listPending(state)).toHaveLength(0);
  });

  it('(b) unmined tx -> entry left in place, attestPublic not reached', async () => {
    const profile = profileWith(REGISTERED_UID);
    const attester = new KlarityAttester({ profile });
    (attester as unknown as { attestPublic: () => Promise<string> }).attestPublic =
      async () => {
        throw new Error('attestPublic must not be reached for an unmined tx');
      };
    // createdAt recent so age budget is NOT exceeded -> entry retained.
    const state = memoryState([
      pendingVouch({ interactionTxHash: TX_UNMINED, createdAt: 2000 }),
    ]);

    await pollPending(
      pollDeps({
        state,
        profile,
        attester: attester as unknown as KlarityAttester,
        provider: fakeProvider({ mined: new Set([TX_MINED]) }),
        getReceipt: fakeGetReceipt({ mined: new Set([TX_MINED]) }),
        now: () => 2000,
      }),
    );

    const remaining = await listPending(state);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].interactionTxHash).toBe(TX_UNMINED);
  });

  it('(c) attemptedUid already set -> not resubmitted (verify/attest never called)', async () => {
    const profile = profileWith(REGISTERED_UID);
    const attester = {
      verifyInteraction: vi.fn(async () => true),
      attestPublic: vi.fn(async () => RESULT_UID),
    } as unknown as KlarityAttester;
    const state = memoryState([
      pendingVouch({ interactionTxHash: TX_MINED, attemptedUid: RESULT_UID }),
    ]);

    await pollPending(
      pollDeps({
        state,
        profile,
        attester,
        provider: fakeProvider({ mined: new Set([TX_MINED]) }),
        getReceipt: fakeGetReceipt({ mined: new Set([TX_MINED]) }),
      }),
    );

    expect(
      (attester as unknown as { verifyInteraction: ReturnType<typeof vi.fn> })
        .verifyInteraction,
    ).not.toHaveBeenCalled();
    expect(
      (attester as unknown as { attestPublic: ReturnType<typeof vi.fn> })
        .attestPublic,
    ).not.toHaveBeenCalled();
    // The already-attempted entry is left intact (not re-polled, not evicted).
    expect(await listPending(state)).toHaveLength(1);
  });

  it('(d) empty publicSchemaUID (MAINNET default) -> gated refusal, no attestPublic, entry retained within budget', async () => {
    const profile = MAINNET; // publicSchemaUID === ''
    const attester = new KlarityAttester({ profile });
    (attester as unknown as { attestPublic: () => Promise<string> }).attestPublic =
      async () => {
        throw new Error('attestPublic must not be reached under the empty-UID gate');
      };
    const state = memoryState([
      pendingVouch({ interactionTxHash: TX_MINED, createdAt: 2000 }),
    ]);

    await pollPending(
      pollDeps({
        state,
        profile,
        attester: attester as unknown as KlarityAttester,
        provider: fakeProvider({ mined: new Set([TX_MINED]) }),
        getReceipt: fakeGetReceipt({ mined: new Set([TX_MINED]) }),
        now: () => 2000,
      }),
    );

    // Gated refusal: no write, and the entry stays (within age budget) so it can
    // light up once a human registers the UID.
    expect(await listPending(state)).toHaveLength(1);
  });

  it('(e) reverted receipt (status 0x0) -> no attestation, entry retained within budget', async () => {
    const profile = profileWith(REGISTERED_UID);
    const attester = new KlarityAttester({ profile });
    (attester as unknown as { attestPublic: () => Promise<string> }).attestPublic =
      async () => {
        throw new Error('attestPublic must not be reached for a reverted tx');
      };
    const state = memoryState([
      pendingVouch({ interactionTxHash: TX_REVERTED, createdAt: 2000 }),
    ]);

    await pollPending(
      pollDeps({
        state,
        profile,
        attester: attester as unknown as KlarityAttester,
        provider: fakeProvider({ reverted: new Set([TX_REVERTED]) }),
        getReceipt: fakeGetReceipt({ reverted: new Set([TX_REVERTED]) }),
        now: () => 2000,
      }),
    );

    // verifyInteraction fails on status 0x0 -> submitVouch returns not-proven,
    // no attestation. Entry retained (within budget) for a later definitive state.
    expect(await listPending(state)).toHaveLength(1);
  });

  it('(budget) an unmined entry past MAX_PENDING_AGE_MS is evicted (no infinite poll)', async () => {
    const profile = profileWith(REGISTERED_UID);
    const attester = new KlarityAttester({ profile });
    (attester as unknown as { attestPublic: () => Promise<string> }).attestPublic =
      async () => {
        throw new Error('attestPublic must not be reached for an unmined tx');
      };
    const createdAt = 1000;
    const state = memoryState([
      pendingVouch({ interactionTxHash: TX_UNMINED, createdAt }),
    ]);

    await pollPending(
      pollDeps({
        state,
        profile,
        attester: attester as unknown as KlarityAttester,
        provider: fakeProvider({ mined: new Set([TX_MINED]) }),
        getReceipt: fakeGetReceipt({ mined: new Set([TX_MINED]) }),
        now: () => createdAt + MAX_PENDING_AGE_MS + 1,
      }),
    );

    expect(await listPending(state)).toHaveLength(0);
  });
});

describe('captureVouch (onUserInput core)', () => {
  const INTERACTION = {
    chainId: 1,
    contract: CONTRACT,
    selector: SELECTOR,
    interactionTxHash: TX_MINED,
    account: ACCOUNT,
  };

  function captureDeps(over: Partial<CaptureVouchDeps> = {}): CaptureVouchDeps {
    return {
      putPending: vi.fn(async () => undefined),
      schedule: vi.fn(async () => 'event-id'),
      notify: vi.fn(async () => undefined),
      now: () => 4242,
      ...over,
    };
  }

  it('success path -> putPending with correct rating/comment, schedule invoked, notify not', async () => {
    const deps = captureDeps();
    await captureVouch(
      {
        event: {
          type: UserInputEventType.FormSubmitEvent,
          name: 'klarity-vouch',
          value: { rating: '4', comment: 'solid' },
        },
        state: { rating: '4', comment: 'solid' },
        interaction: INTERACTION,
      },
      deps,
    );

    const putPending = deps.putPending as unknown as ReturnType<typeof vi.fn>;
    expect(putPending).toHaveBeenCalledOnce();
    const stored = putPending.mock.calls[0][0] as PendingVouch;
    expect(stored.rating).toBe(4);
    expect(stored.comment).toBe('solid');
    expect(stored.interactionTxHash).toBe(TX_MINED);
    expect(stored.account).toBe(ACCOUNT);
    expect(stored.chainId).toBe(1);
    expect(stored.contract).toBe(CONTRACT);
    expect(stored.selector).toBe(SELECTOR);
    expect(stored.createdAt).toBe(4242);
    expect(deps.schedule as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledOnce();
    expect(deps.notify as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it('parse-error path -> notify called, nothing stored, no schedule, no throw', async () => {
    const deps = captureDeps();
    await expect(
      captureVouch(
        {
          event: {
            type: UserInputEventType.FormSubmitEvent,
            name: 'klarity-vouch',
            value: { rating: '', comment: 'x' },
          },
          state: { rating: '', comment: 'x' },
          interaction: INTERACTION,
        },
        deps,
      ),
    ).resolves.toBeUndefined();

    expect(deps.notify as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledOnce();
    expect(deps.putPending as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(deps.schedule as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it('ignores events that are not the klarity-vouch form submit', async () => {
    const deps = captureDeps();
    await captureVouch(
      {
        event: {
          type: UserInputEventType.ButtonClickEvent,
          name: 'something-else',
        },
        state: {},
        interaction: INTERACTION,
      },
      deps,
    );
    expect(deps.putPending as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(deps.schedule as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(deps.notify as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it('exports POLL_METHOD as klarity_poll_pending', () => {
    expect(POLL_METHOD).toBe('klarity_poll_pending');
  });
});
