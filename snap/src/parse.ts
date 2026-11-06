/**
 * Pure transaction-parsing helpers.
 *
 * These are consumed by the `onTransaction` handler in a later task. They do
 * no network or SDK work: they only destructure the raw values MetaMask passes.
 */

/**
 * Parse a CAIP-2 chain identifier of the form `eip155:<reference>` into the
 * numeric EVM chain id. Throws on any input that is not a well-formed
 * `eip155` CAIP-2 string.
 */
export function parseChainId(caip2: string): number {
  const match = /^eip155:(\d+)$/.exec(caip2);
  if (match === null) {
    throw new Error(`Unsupported or malformed CAIP-2 chain id: ${caip2}`);
  }
  return Number.parseInt(match[1], 10);
}

export interface ParsedTx {
  contract: string | null;
  selector: string | null;
  calldata: string | null;
}

/**
 * Split a raw transaction into its clear-signing-relevant parts.
 *
 * - `contract` is the lower-cased `to` address, or `null` when absent.
 * - `selector` is the first 4 bytes of `data` (`0x` + 8 hex chars), or `null`
 *   when `data` is missing or shorter than that (a plain transfer).
 * - `calldata` is the raw `data`, or `null` when absent.
 */
export function parseTx(transaction: { to?: string; data?: string }): ParsedTx {
  const { to, data } = transaction;

  const contract = to === undefined ? null : to.toLowerCase();
  const calldata = data === undefined ? null : data;
  const selector =
    data !== undefined && data.length >= 10 ? data.slice(0, 10) : null;

  return { contract, selector, calldata };
}
