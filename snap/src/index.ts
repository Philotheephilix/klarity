import {
  DialogType,
  MethodNotFoundError,
  type OnRpcRequestHandler,
  type OnTransactionHandler,
} from '@metamask/snaps-sdk';
import type { JSXElement } from '@metamask/snaps-sdk/jsx';
import {
  KlarityAttester,
  KlarityClient,
  type EasProfile,
  type InteractionProvider,
} from '@klarity/sdk';

import { parseChainId, parseTx } from './parse.js';
import { fetchDecode, type FetchDecodeDeps } from './decode.js';
import { fetchVerified, type FetchVerifiedDeps } from './verified.js';
import { renderInsight } from './render.js';
import { renderRankPrompt } from './prompt.js';
import { getApiBaseUrl, profileForChain } from './config.js';
import { buildClaim, submitVouch, type SubmitVouchResult } from './ranking.js';

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
    const { contract, selector, calldata } = parseTx(args.transaction);

    if (contract === null || calldata === null) {
      return { content: asInsightContent(renderInsight(null, null)) };
    }

    const decode = await fetchDecode(
      { chainId, contract, calldata },
      deps.decodeDeps,
    );

    const verified =
      selector === null
        ? null
        : await fetchVerified(chainId, contract, selector, deps.verifiedDeps);

    const interactionContext =
      decode !== null && selector !== null
        ? { chainId, contract, selector }
        : undefined;

    return {
      content: asInsightContent(
        renderInsight(decode, verified, interactionContext),
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
 * dependencies (default clients built against the configured Klarity server).
 */
export const onTransaction: OnTransactionHandler = async (args) =>
  buildInsight(args);

/**
 * The single JSON-RPC method a companion dapp calls to trigger a ranking vouch
 * after a clear-signed transaction is mined.
 */
export const RANK_METHOD = 'klarity_rank';

/**
 * Parameters for {@link RANK_METHOD}.
 *
 * `account` is the address that sent the interaction (the prospective attester);
 * `interactionTxHash` is that mined transaction. `contract`/`selector`/`chainId`
 * identify the descriptor being vouched for.
 */
export interface RankParams {
  chainId: number;
  contract: string;
  selector: string;
  interactionTxHash: string;
  account: string;
}

/**
 * Injectable dependencies for {@link handleRank}.
 *
 * This is the testability seam, consistent with the `deps?` pattern across the
 * codebase ({@link buildInsight}, decode.ts, verified.ts): tests pass a `confirm`
 * stub, a stub/real attester + provider, and a `fetchDescriptor` stub so the
 * core runs with no Snaps runtime and no network. `onRpcRequest` builds the real
 * versions of all five.
 */
export interface RankDeps {
  /** Show a confirmation dialog; resolve true when the user confirms. */
  confirm: (content: JSXElement) => Promise<boolean>;
  /** The SDK attester bound to the chain's EAS profile. */
  attester: KlarityAttester;
  /** Minimal ethers-shaped provider used to prove the interaction tx. */
  provider: InteractionProvider;
  /** Fetch the canonical descriptor object to hash/attest over. */
  fetchDescriptor: () => Promise<object | null>;
  /** The EAS profile (carries the gating `publicSchemaUID`). */
  profile: EasProfile;
}

/**
 * Core ranking flow as an injectable pure function.
 *
 * 1. Fetch the canonical descriptor object (so the vouch binds to the same hash
 *    the server/SDK derive). If it cannot be fetched, submit over an empty
 *    object rather than fabricating one — honest, and the gate still applies.
 * 2. Ask the user whether the transaction did what the clear-signing described.
 * 3. On decline, return `{ submitted: false, reason: 'declined' }` WITHOUT ever
 *    calling {@link submitVouch}.
 * 4. On confirm, build the claim and delegate to the GATED {@link submitVouch},
 *    returning its result verbatim. The gate (empty `publicSchemaUID` → refusal)
 *    lives in ranking.ts and is never bypassed here.
 */
export async function handleRank(
  params: RankParams,
  deps: RankDeps,
): Promise<SubmitVouchResult> {
  const descriptor = (await deps.fetchDescriptor()) ?? {};

  const confirmed = await deps.confirm(
    renderRankPrompt({
      contract: params.contract,
      interactionTxHash: params.interactionTxHash,
    }) as unknown as JSXElement,
  );
  if (!confirmed) {
    return { submitted: false, reason: 'declined' };
  }

  const claim = buildClaim({
    contract: params.contract,
    attester: params.account,
    interactionTxHash: params.interactionTxHash,
  });

  return submitVouch(descriptor, claim, {
    attester: deps.attester,
    provider: deps.provider,
    profile: deps.profile,
  });
}

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
 * Production {@link RankDeps.fetchDescriptor}: fetch the single descriptor row
 * (with its inlined format block) from the Klarity server and return the format
 * block as the canonical descriptor object. Degrades to `null` on any failure.
 */
async function fetchDescriptorFor(params: RankParams): Promise<object | null> {
  try {
    const client = new KlarityClient({ baseUrl: getApiBaseUrl() });
    const row = await client.getDescriptor(
      params.chainId,
      params.contract,
      params.selector,
    );
    return row.formatBlock ?? null;
  } catch {
    return null;
  }
}

/**
 * JSON-RPC handler. A thin wrapper: for {@link RANK_METHOD} it assembles the
 * real {@link RankDeps} (a `snap_dialog` confirmation, an attester for the
 * chain's profile, the `ethereum`-backed provider, the server descriptor fetch)
 * and delegates to {@link handleRank}. Any other method throws method-not-found.
 */
export const onRpcRequest: OnRpcRequestHandler = async ({ request }) => {
  if (request.method !== RANK_METHOD) {
    throw new MethodNotFoundError({ method: request.method });
  }

  const params = request.params as unknown as RankParams;
  const profile = profileForChain(params.chainId);

  const result = await handleRank(params, {
    confirm: async (content) =>
      (await snap.request({
        method: 'snap_dialog',
        params: { type: DialogType.Confirmation, content },
      })) as boolean,
    attester: new KlarityAttester({ profile }),
    provider: ethereumInteractionProvider(),
    fetchDescriptor: async () => fetchDescriptorFor(params),
    profile,
  });

  // Map to a plain JSON record (the handler's declared return is `Json`;
  // `SubmitVouchResult` is an interface, which lacks the index signature `Json`
  // requires, so build the object literal explicitly rather than cast).
  const json: { submitted: boolean; uid?: string; reason?: string } = {
    submitted: result.submitted,
  };
  if (result.uid !== undefined) {
    json.uid = result.uid;
  }
  if (result.reason !== undefined) {
    json.reason = result.reason;
  }
  return json;
};
