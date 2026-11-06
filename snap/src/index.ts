import type { OnTransactionHandler } from '@metamask/snaps-sdk';
import type { JSXElement } from '@metamask/snaps-sdk/jsx';

import { parseChainId, parseTx } from './parse.js';
import { fetchDecode, type FetchDecodeDeps } from './decode.js';
import { fetchVerified, type FetchVerifiedDeps } from './verified.js';
import { renderInsight } from './render.js';

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

    return { content: asInsightContent(renderInsight(decode, verified)) };
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
