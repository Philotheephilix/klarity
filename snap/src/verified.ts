/**
 * Verified-block adapter — fetches the two-tier "verified block" (EF gate +
 * public vouches) for a contract+selector via the `@klarity/sdk` KlarityClient.
 *
 * The Snap is a CLIENT of the existing Klarity server; this module never
 * reimplements trust logic. It builds (or accepts) a client, calls
 * getDescriptor, and degrades gracefully: any failure (absent block,
 * unreachable server, network error) resolves to `null` so the insight panel
 * can show an HONEST trust line instead of crashing.
 */
import { KlarityClient, type VerifiedBlock } from '@klarity/sdk';
import { API_TIMEOUT_MS, getApiBaseUrl } from './config.js';

export interface FetchVerifiedDeps {
  client?: KlarityClient;
}

/**
 * Fetch the verified block for a contract+selector.
 *
 * Returns the descriptor row's `verified` block on success, or `null` when it
 * is absent or the request fails. It never throws out of this function.
 */
export async function fetchVerified(
  chainId: number,
  contract: string,
  selector: string,
  deps: FetchVerifiedDeps = {},
): Promise<VerifiedBlock | null> {
  try {
    const client =
      deps.client ??
      new KlarityClient({ baseUrl: getApiBaseUrl(), timeoutMs: API_TIMEOUT_MS });
    const row = await client.getDescriptor(chainId, contract, selector);
    return row.verified ?? null;
  } catch {
    return null;
  }
}
