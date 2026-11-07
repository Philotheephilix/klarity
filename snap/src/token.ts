/**
 * ERC-20 token metadata resolution for the clear-signing panel.
 *
 * The Snap renders a raw integer amount (e.g. `1000000`) as a human amount with
 * a symbol (e.g. `1.0 USDC`). To do that it needs the token's `decimals()` and
 * `symbol()`, read directly on-chain via the injected EIP-1193 `ethereum`
 * provider with two `eth_call`s.
 *
 * This module is deliberately DEFENSIVE: it never throws and never blocks the
 * panel. Any RPC failure, timeout, or undecodable return resolves to `null`, and
 * the caller falls back to the raw integer. Results are cached per address for
 * the life of the Snap worker so a repeated field never re-hits the RPC.
 */

/** Minimal EIP-1193 request surface the two reads need. */
interface MinimalProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

/** Resolved ERC-20 metadata. `symbol` is `''` when it could not be decoded. */
export interface TokenMeta {
  decimals: number;
  symbol: string;
}

/** `decimals()` 4-byte selector. */
const DECIMALS_SELECTOR = '0x313ce567';
/** `symbol()` 4-byte selector. */
const SYMBOL_SELECTOR = '0x95d89b41';

/** Per-worker cache: lowercased address -> resolved meta (or null on failure). */
const cache = new Map<string, TokenMeta | null>();

/** Timeout budget for the pair of eth_calls, in milliseconds. */
const RESOLVE_TIMEOUT_MS = 2000;

/**
 * Format a raw base-10 integer string by `decimals` using BigInt only (no float
 * precision loss, no bignum dependency). Trailing fractional zeros are trimmed
 * but at least one fractional digit is kept: `"1000000"`/6 -> `"1.0"`,
 * `"1500000"`/6 -> `"1.5"`, `"1"`/6 -> `"0.000001"`, `"42"`/0 -> `"42.0"`.
 */
export function formatAmount(raw: string, decimals: number): string {
  const negative = raw.startsWith('-');
  const digits = (negative ? raw.slice(1) : raw).replace(/^0+(?=\d)/, '');
  const sign = negative ? '-' : '';

  if (decimals <= 0) {
    return `${sign}${digits || '0'}.0`;
  }

  const padded = digits.padStart(decimals + 1, '0');
  const whole = padded.slice(0, padded.length - decimals);
  const fracFull = padded.slice(padded.length - decimals);
  const fracTrimmed = fracFull.replace(/0+$/, '');
  return `${sign}${whole}.${fracTrimmed === '' ? '0' : fracTrimmed}`;
}

/** Default cap on SIGNIFICANT fractional digits shown in the panel. */
const DEFAULT_MAX_SIGNIFICANT = 4;

/**
 * Cap a formatted decimal string to at most `maxSignificant` SIGNIFICANT
 * fractional digits for display — leading zeros after the point do not count,
 * so a tiny amount keeps its magnitude. The integer part is always kept in
 * full. This is a DISPLAY trim, not a precise round: it truncates toward zero
 * rather than rounding, so the shown value never overstates the amount.
 *
 *   `"0.000444551696531516"` -> `"0.0004445"`   (4 significant digits)
 *   `"1.2300000"`            -> `"1.23"`         (already short)
 *   `"1.0"`                  -> `"1.0"`          (one zero digit kept)
 *   `"42"` / `"42."`         -> `"42"`           (no fractional part)
 *
 * A value whose fractional part is entirely below the kept window collapses to
 * `"0"` fractional, so at least one digit always remains after the point.
 */
export function capFractionDigits(
  formatted: string,
  maxSignificant: number = DEFAULT_MAX_SIGNIFICANT,
): string {
  const dot = formatted.indexOf('.');
  if (dot === -1) {
    return formatted;
  }
  const whole = formatted.slice(0, dot);
  const frac = formatted.slice(dot + 1);

  // Count leading zeros, then keep up to `maxSignificant` digits after them.
  const leadingZeros = frac.length - frac.replace(/^0+/, '').length;
  const keep = leadingZeros + Math.max(maxSignificant, 0);
  const capped = frac.slice(0, keep).replace(/0+$/, '');
  return `${whole}.${capped === '' ? '0' : capped}`;
}

/** Decode a 32-byte-word uint8 return as `decimals`. */
function decodeUint8(hex: string): number | null {
  if (typeof hex !== 'string' || !hex.startsWith('0x')) return null;
  const body = hex.slice(2);
  if (body.length === 0) return null;
  const n = Number.parseInt(body, 16);
  if (!Number.isFinite(n) || n < 0 || n > 255) return null;
  return n;
}

/**
 * Decode a `symbol()` return, handling BOTH shapes a token may use:
 *   - ABI dynamic `string`: offset word, length word, utf-8 bytes.
 *   - bytes32-packed: a single 32-byte word of right-padded utf-8 (older tokens).
 * Returns `''` when nothing printable can be recovered (caller keeps decimals).
 */
function decodeSymbol(hex: string): string {
  if (typeof hex !== 'string' || !hex.startsWith('0x')) return '';
  const body = hex.slice(2);
  if (body.length === 0) return '';

  // ABI dynamic string: >= 3 words and a sane offset+length.
  if (body.length >= 192) {
    const offset = Number.parseInt(body.slice(0, 64), 16);
    if (offset === 32) {
      const len = Number.parseInt(body.slice(64, 128), 16);
      if (Number.isFinite(len) && len > 0 && 128 + len * 2 <= body.length) {
        const dataHex = body.slice(128, 128 + len * 2);
        const s = hexToUtf8(dataHex);
        if (s) return s;
      }
    }
  }

  // bytes32-packed fallback: single right-padded word.
  if (body.length >= 64) {
    const s = hexToUtf8(body.slice(0, 64)).replace(/\u0000+$/, '');
    if (s) return s;
  }
  return '';
}

/** Hex -> utf-8, keeping only printable characters; '' on any failure. */
function hexToUtf8(hex: string): string {
  try {
    const clean = hex.replace(/(00)+$/, '');
    if (clean.length === 0 || clean.length % 2 !== 0) {
      if (hex.length % 2 !== 0) return '';
    }
    const bytes = Buffer.from(clean.length % 2 === 0 ? clean : hex, 'hex');
    const s = bytes.toString('utf-8').replace(/\u0000+$/, '');
    // Reject if it carries non-printable control characters (bad decode).
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u0008\u000e-\u001f]/.test(s)) return '';
    return s.trim();
  } catch {
    return '';
  }
}

/** A single `eth_call` to `address` with the given selector; '' on any error. */
async function ethCall(
  provider: MinimalProvider,
  address: string,
  data: string,
): Promise<string> {
  const result = await provider.request({
    method: 'eth_call',
    params: [{ to: address, data }, 'latest'],
  });
  return typeof result === 'string' ? result : '';
}

/**
 * Resolve ERC-20 `decimals()` + `symbol()` for `address` via the provider.
 *
 * Never throws. Returns `null` on ANY failure or if the ~2s budget elapses, so
 * the caller falls back to raw units. `decimals` is required for a non-null
 * result; a missing/undecodable `symbol` degrades to `''` rather than failing.
 * Results (including `null`) are cached per lowercased address.
 */
export async function resolveToken(
  provider: MinimalProvider,
  address: string,
): Promise<TokenMeta | null> {
  const key = address.toLowerCase();
  if (cache.has(key)) {
    return cache.get(key) ?? null;
  }

  const work = (async (): Promise<TokenMeta | null> => {
    let decimals: number | null;
    try {
      const decRet = await ethCall(provider, address, DECIMALS_SELECTOR);
      decimals = decodeUint8(decRet);
    } catch {
      return null;
    }
    if (decimals === null) return null;

    let symbol = '';
    try {
      const symRet = await ethCall(provider, address, SYMBOL_SELECTOR);
      symbol = decodeSymbol(symRet);
    } catch {
      symbol = '';
    }
    return { decimals, symbol };
  })();

  const timeout = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), RESOLVE_TIMEOUT_MS);
  });

  let meta: TokenMeta | null;
  try {
    meta = await Promise.race([work, timeout]);
  } catch {
    meta = null;
  }
  cache.set(key, meta);
  return meta;
}
