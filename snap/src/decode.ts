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
 * Outcome of a decode attempt, three-valued so the panel can tell a genuine
 * "no descriptor" apart from a transport failure it must NOT present as
 * "nothing to clear-sign":
 *
 *   - `{ ok: true, decode }`   — the server returned a 200 DecodeResponse.
 *   - `{ ok: false, reason: 'none' }`  — the server answered 404: it reached
 *     the API and there is genuinely no clear-signing for this call.
 *   - `{ ok: false, reason: 'error', message }` — the request threw before a
 *     definitive 404 (DNS/connect refused, the snap sandbox blocking the host,
 *     a 5xx, malformed JSON, ...). The message is surfaced for diagnosis.
 */
export type DecodeOutcome =
  | { ok: true; decode: DecodeResponse }
  | { ok: false; reason: 'none' }
  | { ok: false; reason: 'error'; message: string };

/** The 404 marker the SDK's KlarityClient embeds in its thrown Error. */
const NOT_FOUND_MARKER = 'failed with 404';

/**
 * Fetch a decode summary from the Klarity server.
 *
 * Returns a {@link DecodeOutcome}. It never throws out of this function: a
 * genuine 404 maps to `reason: 'none'`, and ANY other failure maps to
 * `reason: 'error'` carrying the message, so an unreachable API is never
 * silently indistinguishable from "no descriptor".
 */
export async function fetchDecodeOutcome(
  input: DecodeInput,
  deps: FetchDecodeDeps = {},
): Promise<DecodeOutcome> {
  try {
    const client =
      deps.client ?? new KlarityClient({ baseUrl: getApiBaseUrl() });
    const decode = await client.decode({
      chainId: input.chainId,
      contract: input.contract,
      calldata: input.calldata,
    });
    return { ok: true, decode };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    if (message.includes(NOT_FOUND_MARKER)) {
      return { ok: false, reason: 'none' };
    }
    return { ok: false, reason: 'error', message };
  }
}

/**
 * Back-compat convenience: the original null-or-decode shape. A genuine 404 and
 * a transport error both collapse to `null` here, so callers that need to tell
 * them apart MUST use {@link fetchDecodeOutcome} instead.
 *
 * Returns the server's DecodeResponse on success, or `null` on any error. It
 * never throws out of this function.
 */
export async function fetchDecode(
  input: DecodeInput,
  deps: FetchDecodeDeps = {},
): Promise<DecodeResponse | null> {
  const outcome = await fetchDecodeOutcome(input, deps);
  return outcome.ok ? outcome.decode : null;
}
