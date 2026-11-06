/**
 * Decode adapter — calls the existing Klarity server's POST /decode via the
 * `@klarity/sdk` KlarityClient.
 *
 * The Snap is a CLIENT of that server; this module never reimplements decoding.
 * It only builds (or accepts) a client, forwards the request, and degrades
 * gracefully: any failure (404, unreachable server, network error) resolves to
 * `null` so the caller can fall back to raw signing instead of crashing.
 */
import { KlarityClient, type DecodeResponse } from '@klarity/sdk';
import { getApiBaseUrl } from './config.js';

export interface DecodeInput {
  chainId: number;
  contract: string;
  calldata: string;
}

export interface FetchDecodeDeps {
  client?: KlarityClient;
}

/**
 * Fetch a decode summary from the Klarity server.
 *
 * Returns the server's DecodeResponse on success, or `null` on any error. It
 * never throws out of this function.
 */
export async function fetchDecode(
  input: DecodeInput,
  deps: FetchDecodeDeps = {},
): Promise<DecodeResponse | null> {
  try {
    const client =
      deps.client ?? new KlarityClient({ baseUrl: getApiBaseUrl() });
    return await client.decode({
      chainId: input.chainId,
      contract: input.contract,
      calldata: input.calldata,
    });
  } catch {
    return null;
  }
}
