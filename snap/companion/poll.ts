/**
 * Pure, testable polling helper for the companion dapp.
 *
 * After a user submits a transaction, the page needs to wait for it to be mined
 * before invoking the Snap's ranking RPC. This module isolates that retry loop
 * from any DOM or `window.ethereum` glue so it can be unit-tested with no real
 * timers and no browser.
 */

/** A receipt as returned by `eth_getTransactionReceipt`: `null` until mined. */
export type Receipt = { status?: string | null } | null;

/** Injectable dependencies for {@link waitForReceipt}. */
export interface WaitDeps {
  /** Fetch the receipt for a tx hash; resolves `null` while still pending. */
  getReceipt: (hash: string) => Promise<Receipt>;
  /**
   * Delay between polls. Defaults to a real timer. Tests inject a no-op (or set
   * `intervalMs` to 0) so the suite never actually waits seconds.
   */
  sleep?: (ms: number) => Promise<void>;
}

/** Tuning knobs for {@link waitForReceipt}. */
export interface WaitOpts {
  /** Milliseconds to wait between tries. Default 1500. */
  intervalMs?: number;
  /** Maximum number of `getReceipt` calls before giving up. Default 10. */
  maxTries?: number;
}

/** Outcome of {@link waitForReceipt}. */
export interface WaitResult {
  mined: boolean;
  status?: string | null;
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll `deps.getReceipt(txHash)` until a non-null receipt is returned.
 *
 * Returns `{ mined: true, status }` as soon as a receipt appears, otherwise
 * `{ mined: false }` once `maxTries` null results have been seen. Waits
 * `intervalMs` between tries (never after the final try).
 */
export async function waitForReceipt(
  txHash: string,
  deps: WaitDeps,
  opts: WaitOpts = {},
): Promise<WaitResult> {
  const intervalMs = opts.intervalMs ?? 1500;
  const maxTries = opts.maxTries ?? 10;
  const sleep = deps.sleep ?? realSleep;

  for (let attempt = 0; attempt < maxTries; attempt++) {
    const receipt = await deps.getReceipt(txHash);
    if (receipt !== null) {
      return { mined: true, status: receipt.status };
    }
    if (attempt < maxTries - 1) {
      await sleep(intervalMs);
    }
  }
  return { mined: false };
}
