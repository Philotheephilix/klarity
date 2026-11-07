/**
 * Pending-vouch store.
 *
 * A vouch is captured PRE-SIGN and stored PENDING, keyed by the interaction's
 * transaction hash, until that transaction is mined and the vouch can be
 * submitted on-chain. This module is the persistence layer for that pending set.
 *
 * It is PURE over an injected state accessor ({@link StateDeps}): the exported
 * functions never call `snap.request` directly, so tests drive them with an
 * in-memory stub. A thin production wrapper ({@link snapStateDeps}) builds the
 * accessor from `snap_manageState`.
 *
 * Keying by `interactionTxHash` is deliberate: putting the same tx twice
 * OVERWRITES rather than appends, so a double-submit of the capture form can
 * never produce two pending entries for one interaction.
 */

import type { Json } from '@metamask/utils';

/**
 * A captured-but-not-yet-submitted vouch. `attemptedUid` is set once a
 * submission has produced an attestation UID, guarding against re-attesting the
 * same interaction.
 */
export interface PendingVouch {
  chainId: number;
  contract: string;
  selector: string;
  interactionTxHash: string;
  account: string;
  rating: number;
  comment: string;
  createdAt: number;
  attemptedUid?: string;
}

/** The persisted shape: pending vouches keyed by `interactionTxHash`. */
export type PendingState = {
  pending: Record<string, PendingVouch>;
};

/**
 * The injectable state seam. Production wraps `snap_manageState`; tests inject
 * an in-memory closure. `get` may resolve to `undefined`/`null`/`{}` on first
 * run; {@link normalize} copes with all three.
 */
export interface StateDeps {
  get(): Promise<PendingState | null | undefined>;
  set(s: PendingState): Promise<void>;
}

/**
 * Normalize any first-run or legacy state into a well-formed {@link PendingState}.
 *
 * @param raw - The raw value `StateDeps.get` returned.
 * @returns A state whose `pending` is always a plain object.
 */
function normalize(raw: PendingState | null | undefined): PendingState {
  if (raw === null || raw === undefined || typeof raw !== 'object') {
    return { pending: {} };
  }
  const { pending } = raw as Partial<PendingState>;
  if (pending === null || pending === undefined || typeof pending !== 'object') {
    return { pending: {} };
  }
  return { pending };
}

/**
 * Store a pending vouch, keyed by its `interactionTxHash`.
 *
 * Idempotent per tx: a second put with the same `interactionTxHash` overwrites
 * the first, so there is never more than one pending entry per interaction.
 *
 * @param deps - The injected state accessor.
 * @param vouch - The vouch to store.
 */
export async function putPending(
  deps: StateDeps,
  vouch: PendingVouch,
): Promise<void> {
  const state = normalize(await deps.get());
  state.pending[vouch.interactionTxHash] = vouch;
  await deps.set(state);
}

/**
 * List all pending vouches.
 *
 * @param deps - The injected state accessor.
 * @returns The stored vouches (empty array when none / first run).
 */
export async function listPending(deps: StateDeps): Promise<PendingVouch[]> {
  const state = normalize(await deps.get());
  return Object.values(state.pending);
}

/**
 * Remove the pending vouch for a given interaction tx hash.
 *
 * @param deps - The injected state accessor.
 * @param txHash - The `interactionTxHash` key to delete.
 */
export async function removePending(
  deps: StateDeps,
  txHash: string,
): Promise<void> {
  const state = normalize(await deps.get());
  delete state.pending[txHash];
  await deps.set(state);
}

/**
 * Record that a submission attempt for a pending vouch produced an attestation
 * UID. No-op when the key is absent.
 *
 * @param deps - The injected state accessor.
 * @param txHash - The `interactionTxHash` key to mark.
 * @param uid - The attestation UID the submission produced.
 */
export async function markAttempted(
  deps: StateDeps,
  txHash: string,
  uid: string,
): Promise<void> {
  const state = normalize(await deps.get());
  const entry = state.pending[txHash];
  if (entry === undefined) {
    return;
  }
  entry.attemptedUid = uid;
  await deps.set(state);
}

/**
 * Build a production {@link StateDeps} backed by `snap_manageState`.
 *
 * This is the only place that touches `snap.request`; it is intentionally NOT
 * exercised by unit tests, which inject an in-memory accessor instead.
 *
 * @returns A state accessor over the Snap's encrypted manage-state store.
 */
export function snapStateDeps(): StateDeps {
  return {
    get: async () =>
      (await snap.request({
        method: 'snap_manageState',
        params: { operation: 'get' },
      })) as PendingState | null,
    set: async (s: PendingState) => {
      await snap.request({
        method: 'snap_manageState',
        params: {
          operation: 'update',
          newState: s as unknown as Record<string, Json>,
        },
      });
    },
  };
}
