import {
  DialogType,
  MethodNotFoundError,
  UserInputEventType,
  type OnCronjobHandler,
  type OnHomePageHandler,
  type OnTransactionHandler,
  type OnUserInputHandler,
} from '@metamask/snaps-sdk';
import type { JSXElement } from '@metamask/snaps-sdk/jsx';
import { Box, Text } from '@metamask/snaps-sdk/jsx';
import {
  KlarityAttester,
  type DecodeResponse,
  type EasProfile,
  type InteractionProvider,
} from '@klarity/sdk';

import { parseChainId, parseTx } from './parse.js';
import { fetchDecodeOutcome, type FetchDecodeDeps } from './decode.js';
import { fetchVerified, type FetchVerifiedDeps } from './verified.js';
import { renderInsight, type TokenMetaMap } from './render.js';
import { resolveToken, type TokenMeta } from './token.js';
import { renderHome } from './home.js';
import { profileForChain } from './config.js';
import { buildClaim, submitVouch } from './ranking.js';
import { parseVouchInput } from './vouch-form.js';
import { waitForReceipt, type Receipt, type WaitOpts } from './poll.js';
import {
  listPending,
  markAttempted,
  putPending,
  removePending,
  snapStateDeps,
  type PendingVouch,
  type StateDeps,
} from './pending.js';

/**
 * Arguments passed to the transaction-insight handler, as defined by the Snaps
 * SDK's `OnTransactionHandler`: `{ transaction, chainId, transactionOrigin? }`.
 */
type OnTransactionArgs = Parameters<OnTransactionHandler>[0];

/**
 * Injectable dependencies for {@link buildInsight}.
 *
 * These mirror the `deps?` seams already used by `decode.ts` and `verified.ts`,
 * so the composition can be driven in tests without any network access.
 */
export interface BuildInsightDeps {
  decodeDeps?: FetchDecodeDeps;
  verifiedDeps?: FetchVerifiedDeps;
  /**
   * Resolver for ERC-20 token metadata, injected for tests. Production binds it
   * to the Snaps `ethereum` provider via {@link resolveToken}. Omitting it (e.g.
   * in a test with no provider) yields an empty map and the panel shows raw
   * integer amounts rather than formatted ones.
   */
  resolveToken?: (address: string) => Promise<TokenMeta | null>;
}

/** The literal zero address — ERC-7730's native-asset sentinel, not an ERC-20. */
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/u;

/**
 * Fill `@.from`-pathed fields from the transaction's sender.
 *
 * ERC-7730 descriptors reference transaction-level values the calldata does not
 * carry — a 1inch "Beneficiary" is `@.from`, the sender. The decode server
 * cannot know `from` (it only sees contract + calldata), so it leaves such a
 * field's `value` undefined and the panel shows `-`. MetaMask DOES pass the
 * sender to `onTransaction`, so we fill it in here: any field (visible, hidden,
 * or one level of inner call) whose `path` is `@.from` and whose `value` is not
 * already set gets the lower-cased sender and `type: 'address'`, so the renderer
 * shows it as a truncated, copyable address. A missing `from` fills nothing.
 */
function fillTxLevelFields(decode: DecodeResponse, from: string | null): void {
  if (from === null || !ADDRESS_RE.test(from)) {
    return;
  }
  const fill = (fields: DecodeResponse['fields']): void => {
    for (const field of fields) {
      if (field.path === '@.from' && field.value === undefined) {
        field.value = from;
        field.type = 'address';
      }
      if (field.inner) {
        fill(field.inner.fields);
        fill(field.inner.hiddenFields);
      }
    }
  };
  fill(decode.fields);
  fill(decode.hiddenFields);
}

/**
 * Collect every concrete ERC-20 token address referenced by an amount field,
 * walking one level of nested `inner` call too. Only `params.token` literals are
 * collected; `params.tokenPath` indirections and the zero address are skipped
 * (unresolved references, not ERC-20s). Addresses are lowercased.
 */
function collectTokenAddresses(decode: DecodeResponse): Set<string> {
  const out = new Set<string>();
  const scan = (fields: DecodeResponse['fields']): void => {
    for (const field of fields) {
      const token = field.params?.token;
      if (
        typeof token === 'string' &&
        ADDRESS_RE.test(token) &&
        token.toLowerCase() !== ZERO_ADDRESS
      ) {
        out.add(token.toLowerCase());
      }
      if (field.inner) {
        scan(field.inner.fields);
      }
    }
  };
  scan(decode.fields);
  scan(decode.hiddenFields);
  return out;
}

/**
 * Pre-resolve a token-metadata map for every token address an amount field
 * references, so the synchronous `renderInsight` can format amounts without a
 * live provider. Resolution is per-address and non-throwing; a failed resolve is
 * stored as `null`, which the renderer shows as `"<raw> (raw)"`.
 */
async function resolveTokenMeta(
  decode: DecodeResponse,
  resolve: (address: string) => Promise<TokenMeta | null>,
): Promise<TokenMetaMap> {
  const addresses = [...collectTokenAddresses(decode)];
  const map: TokenMetaMap = new Map();
  await Promise.all(
    addresses.map(async (address) => {
      try {
        map.set(address, await resolve(address));
      } catch {
        map.set(address, null);
      }
    }),
  );
  return map;
}

/**
 * Narrow the insight panel to the SDK's `JSXElement` content type.
 *
 * `render.tsx` binds its documented `JSX.Element` return type to the SDK's
 * `GenericSnapElement`, which is structurally wider than the discriminated
 * `JSXElement` union the transaction-insight response requires. The runtime
 * value is always a real Snaps element tree (`Box`/`Heading`/...), so this is a
 * pure boundary narrowing with no behavioural effect.
 */
function asInsightContent(element: ReturnType<typeof renderInsight>): JSXElement {
  return element as unknown as JSXElement;
}

/**
 * Compose the four building-block modules into a single clear-signing insight
 * response.
 *
 * Flow: parse the CAIP-2 chain id and the raw transaction, fetch the decode
 * summary, fetch the verified block ONLY when the transaction carries a 4-byte
 * selector (a plain transfer has none), then render the insight panel.
 *
 * The ENTIRE body is guarded: any throw (malformed chain id, parse error, etc.)
 * degrades to the honest no-data panel rather than escaping the handler. The
 * adapters themselves already resolve to `null` on failure, so this guard only
 * ever fires on synchronous parse errors.
 *
 * @param args - The `onTransaction` arguments.
 * @param deps - Optional injectable adapter dependencies (for tests).
 * @returns An object with the rendered `content` for the insight panel.
 */
export async function buildInsight(
  args: OnTransactionArgs,
  deps: BuildInsightDeps = {},
): Promise<{ content: JSXElement }> {
  try {
    const chainId = parseChainId(args.chainId);
    const { contract, selector, calldata, from } = parseTx(args.transaction);

    if (contract === null || calldata === null) {
      return { content: asInsightContent(renderInsight(null, null)) };
    }

    const decodeOutcome = await fetchDecodeOutcome(
      { chainId, contract, calldata },
      deps.decodeDeps,
    );
    const decode = decodeOutcome.ok ? decodeOutcome.decode : null;
    const decodeError =
      decodeOutcome.ok || decodeOutcome.reason !== 'error'
        ? null
        : decodeOutcome.message;

    if (decode !== null) {
      fillTxLevelFields(decode, from);
    }

    const verified =
      selector === null
        ? null
        : await fetchVerified(chainId, contract, selector, deps.verifiedDeps);

    const interactionContext =
      decode !== null && selector !== null
        ? { chainId, contract, selector }
        : undefined;

    const tokenMeta =
      decode !== null && deps.resolveToken !== undefined
        ? await resolveTokenMeta(decode, deps.resolveToken)
        : new Map<string, TokenMeta | null>();

    return {
      content: asInsightContent(
        renderInsight(decode, verified, interactionContext, decodeError, tokenMeta),
      ),
    };
  } catch {
    return { content: asInsightContent(renderInsight(null, null)) };
  }
}

/**
 * Transaction insight handler.
 *
 * A thin wrapper over {@link buildInsight} that calls it with real adapter
 * dependencies (default clients built against the configured Klarity server),
 * binding token-metadata resolution to the Snaps `ethereum` provider.
 */
export const onTransaction: OnTransactionHandler = async (args) =>
  buildInsight(args, {
    resolveToken: async (address) => resolveToken(ethereum, address),
  });

/**
 * Wrap the Snaps global `ethereum` (EIP-1193) as the minimal
 * {@link InteractionProvider} the SDK needs to prove an interaction tx. Only the
 * two reads used by `verifyInteraction` are implemented.
 */
function ethereumInteractionProvider(): InteractionProvider {
  return {
    async getTransaction(hash) {
      const tx = (await ethereum.request({
        method: 'eth_getTransactionByHash',
        params: [hash],
      })) as { to: string | null; from: string } | null;
      return tx;
    },
    async getTransactionReceipt(hash) {
      const receipt = (await ethereum.request({
        method: 'eth_getTransactionReceipt',
        params: [hash],
      })) as { status?: number | null } | null;
      return receipt;
    },
  };
}

/**
 * The JSON-RPC method name carried on the scheduled background event. When a
 * capture succeeds, `onUserInput` schedules a one-off background event whose
 * `request.method` is this; `@metamask/snaps-sdk@10.4.0` delivers that event to
 * `onCronjob`, which polls the pending vouch's receipt and submits when mined.
 */
export const POLL_METHOD = 'klarity_poll_pending';

/**
 * How long a pending vouch may stay un-submitted before the poller EVICTS it so
 * it never polls forever. Measured from `createdAt`. A tx that never mines (or
 * stays reverted/unprovable) past this budget is dropped on the next fire; a tx
 * that mines-and-submits is removed immediately regardless of age.
 *
 * 24 hours: comfortably longer than any realistic mempool dwell, short enough
 * that an abandoned capture does not linger indefinitely in encrypted state.
 */
export const MAX_PENDING_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * The interaction context a captured vouch is keyed to. Supplied to
 * {@link captureVouch} by the `onUserInput` wrapper from the interface context
 * that `onTransaction` embedded when it rendered the capture form.
 */
export interface CaptureInteraction {
  chainId: number;
  contract: string;
  selector: string;
  interactionTxHash: string;
  account: string;
}

/**
 * Arguments to the {@link captureVouch} core.
 *
 * `state` is the already-read form state (production reads it via
 * `snap_getInterfaceState`; the core takes it pre-read so it needs no Snaps
 * runtime). `interaction` is the context the vouch is keyed to.
 */
export interface CaptureVouchArgs {
  event: { type: UserInputEventType; name?: string };
  state: { rating?: string; comment?: string };
  interaction: CaptureInteraction;
}

/**
 * Injectable dependencies for {@link captureVouch} — the `onUserInput`
 * testability seam, mirroring the other deps seams. Production wires
 * `putPending` over `snap_manageState`, `schedule` over
 * `snap_scheduleBackgroundEvent`, and `notify` over a `snap_dialog` alert.
 */
export interface CaptureVouchDeps {
  /** Persist the pending vouch (keyed by interaction tx hash). */
  putPending: (vouch: PendingVouch) => Promise<void>;
  /** Schedule the one-off poll background event; resolves the event id. */
  schedule: () => Promise<string>;
  /** Surface a native, non-throwing message to the user (parse errors). */
  notify: (message: string) => Promise<void>;
  /** Clock for `createdAt`; injected so tests are deterministic. */
  now: () => number;
}

/**
 * Capture core as an injectable pure function (no Snaps runtime, no network).
 *
 * Only acts on a {@link UserInputEventType.FormSubmitEvent} for the
 * `klarity-vouch` form; any other event is ignored. On an invalid/empty input it
 * surfaces a clear native message via `notify` and stores NOTHING — it never
 * throws, so an empty form can never produce an unhandled rejection. On a valid
 * input it stores a {@link PendingVouch} and schedules the poll.
 */
export async function captureVouch(
  args: CaptureVouchArgs,
  deps: CaptureVouchDeps,
): Promise<void> {
  const { event, state, interaction } = args;
  if (
    event.type !== UserInputEventType.FormSubmitEvent ||
    event.name !== 'klarity-vouch'
  ) {
    return;
  }

  const parsed = parseVouchInput(state);
  if ('error' in parsed) {
    await deps.notify(parsed.error);
    return;
  }

  const vouch: PendingVouch = {
    chainId: interaction.chainId,
    contract: interaction.contract,
    selector: interaction.selector,
    interactionTxHash: interaction.interactionTxHash,
    account: interaction.account,
    rating: parsed.rating,
    comment: parsed.comment,
    createdAt: deps.now(),
  };

  await deps.putPending(vouch);
  await deps.schedule();
}

/**
 * Injectable dependencies for {@link pollPending} — the `onCronjob` testability
 * seam. Production wires the pending store over `snap_manageState`, `getReceipt`
 * + `provider` over the `ethereum` provider, the attester + profile over the
 * chain's EAS profile, and `now` over the wall clock.
 */
export interface PollPendingDeps {
  /** The pending-vouch store accessor. */
  state: StateDeps;
  /** Fetch a receipt for a tx hash; `null` until mined. */
  getReceipt: (hash: string) => Promise<Receipt>;
  /** The SDK attester bound to the chain's EAS profile. */
  attester: KlarityAttester;
  /** Minimal ethers-shaped provider used by `submitVouch`'s `verifyInteraction`. */
  provider: InteractionProvider;
  /** The EAS profile (carries the gating `publicSchemaUID`). */
  profile: EasProfile;
  /** Clock for the age budget. */
  now: () => number;
  /** Poll tuning for `waitForReceipt`. */
  waitOpts?: WaitOpts;
}

/**
 * Poll-and-submit core as an injectable pure function.
 *
 * For EACH pending vouch:
 *   (i)   SKIP if `attemptedUid` is already set — the double-submit guard; a tx
 *         is never attested twice even if a prior cron fire overlaps this one.
 *   (ii)  Poll the receipt. If NOT mined: leave the entry so a later fire
 *         retries, UNLESS `now - createdAt` exceeds {@link MAX_PENDING_AGE_MS},
 *         in which case EVICT it so it never polls forever.
 *   (iii) If mined: call the GATED {@link submitVouch}. The gate (empty
 *         `publicSchemaUID` -> refusal) and the `verifyInteraction` proof (a
 *         reverted `status 0x0` receipt fails it) both live in the SDK and are
 *         never duplicated here. On `{ submitted: true, uid }`, `markAttempted`
 *         THEN `removePending`. On a refusal (gated or reverted/unprovable),
 *         leave the entry within budget / evict once past it — same policy as an
 *         unmined tx, so a never-definitive vouch cannot linger forever.
 */
export async function pollPending(deps: PollPendingDeps): Promise<void> {
  const pending = await listPending(deps.state);

  for (const vouch of pending) {
    if (vouch.attemptedUid !== undefined) {
      continue; // (i) already attested — never resubmit
    }

    // Isolate each entry: a flaky RPC read (receipt fetch or the provider read
    // inside verifyInteraction) must not abort the whole poll or escape the cron
    // handler as an unhandled rejection. On any throw, leave this entry pending
    // (no state change) and move on; a later scheduled fire retries it.
    try {
      const aged = deps.now() - vouch.createdAt > MAX_PENDING_AGE_MS;

      const receipt = await waitForReceipt(
        vouch.interactionTxHash,
        { getReceipt: deps.getReceipt },
        deps.waitOpts,
      );

      if (!receipt.mined) {
        // (ii) unmined: evict past the budget, otherwise leave for a later fire.
        if (aged) {
          await removePending(deps.state, vouch.interactionTxHash);
        }
        continue;
      }

      // (iii) mined: GATED submit. submitVouch never writes under an empty UID
      // and never attests a reverted/forged interaction (verifyInteraction fails).
      const result = await submitVouch(
        {},
        buildClaim({
          contract: vouch.contract,
          attester: vouch.account,
          interactionTxHash: vouch.interactionTxHash,
          rating: vouch.rating,
          comment: vouch.comment,
        }),
        {
          attester: deps.attester,
          provider: deps.provider,
          profile: deps.profile,
        },
      );

      if (result.submitted && result.uid !== undefined) {
        await markAttempted(deps.state, vouch.interactionTxHash, result.uid);
        await removePending(deps.state, vouch.interactionTxHash);
      } else if (aged) {
        // Gated refusal or reverted/unprovable interaction: same eviction policy
        // as unmined — keep within budget, drop once past it.
        await removePending(deps.state, vouch.interactionTxHash);
      }
    } catch (error) {
      // Transient failure for this entry; keep it pending and continue the loop.
      console.error(
        `klarity: poll failed for ${vouch.interactionTxHash}; leaving pending`,
        error,
      );
      continue;
    }
  }
}

/**
 * User-input handler. A thin wrapper: on a `klarity-vouch` form submit it reads
 * the form via `snap_getInterfaceState`, pulls the interaction context the
 * insight panel embedded for this interface, and delegates to
 * {@link captureVouch} with real deps (pending store, `snap_scheduleBackgroundEvent`
 * scheduling, a `snap_dialog` alert for parse errors).
 */
export const onUserInput: OnUserInputHandler = async ({ id, event, context }) => {
  if (
    event.type !== UserInputEventType.FormSubmitEvent ||
    event.name !== 'klarity-vouch'
  ) {
    return;
  }

  const state = (await snap.request({
    method: 'snap_getInterfaceState',
    params: { id },
  })) as { rating?: string; comment?: string };

  const interaction = (context ?? {}) as unknown as CaptureInteraction;

  await captureVouch(
    { event: { type: event.type, name: event.name }, state, interaction },
    {
      putPending: async (vouch) => putPending(snapStateDeps(), vouch),
      schedule: async () =>
        (await snap.request({
          method: 'snap_scheduleBackgroundEvent',
          params: {
            duration: 'PT30S',
            request: { method: POLL_METHOD },
          },
        })) as string,
      notify: async (message) => {
        await snap.request({
          method: 'snap_dialog',
          params: {
            type: DialogType.Alert,
            content: Box({ children: Text({ children: message }) }) as unknown as JSXElement,
          },
        });
      },
      now: () => Date.now(),
    },
  );
};

/**
 * Cronjob handler. A thin wrapper: for the scheduled {@link POLL_METHOD} event it
 * assembles the real {@link PollPendingDeps} (pending store over
 * `snap_manageState`, the `ethereum`-backed provider for both receipt reads and
 * `verifyInteraction`, an attester + profile per chain) and delegates to
 * {@link pollPending}. Any other method throws method-not-found.
 *
 * NOTE: the production profile is resolved per chain from the pending entries;
 * here we resolve one profile up front from the first entry's chain, matching
 * the single-chain MVP. `pollPending` itself is chain-agnostic over its deps.
 */
export const onCronjob: OnCronjobHandler = async ({ request }) => {
  if (request.method !== POLL_METHOD) {
    throw new MethodNotFoundError({ method: request.method });
  }

  const state = snapStateDeps();
  const pending = await listPending(state);
  if (pending.length === 0) {
    return null;
  }

  const profile = profileForChain(pending[0].chainId);
  const provider = ethereumInteractionProvider();

  await pollPending({
    state,
    getReceipt: async (hash) => provider.getTransactionReceipt(hash) as Promise<Receipt>,
    attester: new KlarityAttester({ profile }),
    provider,
    profile,
    now: () => Date.now(),
  });

  return null;
};

/**
 * Home-page handler. Renders the pending/submitted vouch dashboard when the user
 * opens the Snap's home page in MetaMask. A thin wrapper: it reads the pending
 * store over `snap_manageState` and delegates all layout to {@link renderHome}.
 */
export const onHomePage: OnHomePageHandler = async () => ({
  content: renderHome(await listPending(snapStateDeps())),
});
