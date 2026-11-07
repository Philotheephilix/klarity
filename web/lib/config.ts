import { KlarityApi } from './api';

const ENV_KEY = 'NEXT_PUBLIC_KLARITY_API_BASE';

// Same-origin path the Next rewrites proxy exposes (see next.config.mjs). The
// browser hits this instead of the API origin directly, so requests are
// same-origin and never trip CORS. Overridable via NEXT_PUBLIC_KLARITY_API_PROXY.
const PROXY_PATH = process.env.NEXT_PUBLIC_KLARITY_API_PROXY || '/klarity-api';

/**
 * The direct API origin from the environment. Used for SSR/node runtime (where
 * same-origin has no meaning) and asserted by unit tests. Throws when unset.
 */
export function apiBase(): string {
  const base = process.env.NEXT_PUBLIC_KLARITY_API_BASE;
  if (!base) {
    throw new Error(
      `${ENV_KEY} is not set. Point it at your Klarity API origin (see web/.env.example).`,
    );
  }
  return base;
}

/**
 * The base URL the API client should target.
 *
 * - In the BROWSER: the same-origin proxy path (e.g. "/klarity-api"). The Next
 *   dev/node server rewrites it to the real API origin server-side, so the
 *   fetch is same-origin and CORS never applies.
 * - On the SERVER (SSR) and in UNIT TESTS: the direct env base, because there
 *   is no same-origin server to proxy through. Tests stub NEXT_PUBLIC_KLARITY_API_BASE,
 *   so this keeps their behaviour unchanged.
 */
export function clientApiBase(): string {
  if (typeof window !== 'undefined') return PROXY_PATH;
  return apiBase();
}

export function makeApi(): KlarityApi {
  return new KlarityApi(clientApiBase());
}
