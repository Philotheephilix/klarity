import { decodeAbiParameters, parseAbiParameters, size, type Hex } from 'viem';

/**
 * A decoded ERC-20 permit payload, as carried in the `permit` arg of a 1inch
 * `permitAndCall`. `format` names the layout family; `fields` are the decoded
 * values as label/value pairs (ready for the snap to render); `raw` is the
 * original 0x-hex bytes (lowercased) for honest fallback.
 */
export interface PermitDecoded {
  format: 'eip2612' | 'dai' | 'permit2' | 'unknown';
  fields: { label: string; value: string }[];
  raw: string;
}

/**
 * The permit layouts are discriminated SOLELY by the permit byte length, keyed
 * on 1inch's `SafeERC20.tryPermit` length switch. The full (abi.encoded) forms:
 *   224 = full EIP-2612  (owner, spender, value, deadline, v, r, s)      — 7 words
 *   256 = full DAI       (holder, spender, nonce, expiry, allowed, v,r,s) — 8 words
 *   352 = full Permit2   (owner, PermitSingle, bytes64 signature)
 * The compact (abi.encodePacked) forms 1inch also accepts:
 *   100 = compact EIP-2612, 72 = compact DAI, 96 = compact Permit2
 * Every full length is distinct from every other and from each compact length,
 * so length alone resolves the layout deterministically — a DAI blob (256) can
 * never be mis-read as EIP-2612 (224). Any other length -> `unknown` + raw.
 */
const FULL_EIP2612 = 224;
const FULL_DAI = 256;
const FULL_PERMIT2 = 352;
const COMPACT_EIP2612 = 100;
const COMPACT_DAI = 72;
const COMPACT_PERMIT2 = 96;

/**
 * 1inch's on-wire `permit` arg for `permitAndCall` is specifically
 * `token(20) ++ permitPayload`: a leading 20-byte ERC-20 token address followed
 * by one of the known bare payloads above. So each `KNOWN + 20` length means
 * "strip 20 token bytes, decode the remainder against the KNOWN branch".
 *
 * The +20 lengths — 244, 276, 372, 120, 92, 116 — are pairwise distinct AND
 * distinct from every bare length {224,256,352,100,72,96}. Proof: sort the
 * union {72,92,96,100,116,120,224,244,256,276,352,372} — all twelve differ, so
 * any length resolves deterministically to at most one (format, prefixed?) pair.
 * The strip is a fixed 20 bytes keyed to these six remainder-lengths; we do NOT
 * scan multiple offsets (that would reintroduce mis-decode risk).
 */
const TOKEN_PREFIX = 20;
const PREFIXED_EIP2612 = FULL_EIP2612 + TOKEN_PREFIX; // 244
const PREFIXED_DAI = FULL_DAI + TOKEN_PREFIX; // 276
const PREFIXED_PERMIT2 = FULL_PERMIT2 + TOKEN_PREFIX; // 372
const PREFIXED_COMPACT_EIP2612 = COMPACT_EIP2612 + TOKEN_PREFIX; // 120
const PREFIXED_COMPACT_DAI = COMPACT_DAI + TOKEN_PREFIX; // 92
const PREFIXED_COMPACT_PERMIT2 = COMPACT_PERMIT2 + TOKEN_PREFIX; // 116

function hexBytes(v: unknown): Hex | null {
  if (typeof v !== 'string') return null;
  if (!/^0x([0-9a-fA-F]{2})*$/.test(v)) return null;
  return v.toLowerCase() as Hex;
}

function dec(v: bigint | number): string {
  return v.toString();
}

/** Full EIP-2612: (owner, spender, value, deadline, v, r, s) — 224 bytes. */
function decodeEip2612Full(raw: Hex): PermitDecoded['fields'] {
  const [owner, spender, value, deadline, v, r, s] = decodeAbiParameters(
    parseAbiParameters('address,address,uint256,uint256,uint8,bytes32,bytes32'),
    raw,
  );
  return [
    { label: 'Owner', value: owner as string },
    { label: 'Spender', value: spender as string },
    { label: 'Value', value: dec(value as bigint) },
    { label: 'Deadline', value: dec(deadline as bigint) },
    { label: 'v', value: dec(v as number) },
    { label: 'r', value: r as string },
    { label: 's', value: s as string },
  ];
}

/** Full DAI: (holder, spender, nonce, expiry, allowed, v, r, s) — 256 bytes. */
function decodeDaiFull(raw: Hex): PermitDecoded['fields'] {
  const [holder, spender, nonce, expiry, allowed, v, r, s] = decodeAbiParameters(
    parseAbiParameters('address,address,uint256,uint256,bool,uint8,bytes32,bytes32'),
    raw,
  );
  return [
    { label: 'Holder', value: holder as string },
    { label: 'Spender', value: spender as string },
    { label: 'Nonce', value: dec(nonce as bigint) },
    { label: 'Expiry', value: dec(expiry as bigint) },
    { label: 'Allowed', value: (allowed as boolean) ? 'true' : 'false' },
    { label: 'v', value: dec(v as number) },
    { label: 'r', value: r as string },
    { label: 's', value: s as string },
  ];
}

/**
 * Full Permit2: permit(address owner, PermitSingle permitSingle, bytes signature)
 * where PermitSingle = ((address token, uint160 amount, uint48 expiration,
 * uint48 nonce) details, address spender, uint256 sigDeadline). 352 bytes with
 * 1inch's 64-byte compact (EIP-2098) signature.
 */
function decodePermit2Full(raw: Hex): PermitDecoded['fields'] {
  const [owner, permitSingle, signature] = decodeAbiParameters(
    parseAbiParameters(
      'address,((address,uint160,uint48,uint48),address,uint256),bytes',
    ),
    raw,
  );
  const [details, spender, sigDeadline] = permitSingle as readonly [
    readonly [string, bigint, number, number],
    string,
    bigint,
  ];
  const [token, amount, expiration, nonce] = details;
  return [
    { label: 'Owner', value: owner as string },
    { label: 'Token', value: token },
    { label: 'Amount', value: dec(amount) },
    { label: 'Expiration', value: dec(expiration) },
    { label: 'Nonce', value: dec(nonce) },
    { label: 'Spender', value: spender },
    { label: 'Signature deadline', value: dec(sigDeadline) },
    { label: 'Signature', value: signature as string },
  ];
}

/**
 * Classify and decode an ERC-20 permit `bytes` blob by its length, per 1inch's
 * `SafeERC20.tryPermit` switch. Full forms are abi-decoded to labeled fields;
 * compact (packed) forms are recognized by length but left as raw-only (their
 * non-32-aligned layout is out of scope for this iteration). Unknown length, or
 * any decode failure, yields `{ format:'unknown', fields:[], raw }` — this
 * never throws, so a malformed permit degrades to an honest raw fallback.
 */
export function decodePermit(permit: string): PermitDecoded {
  const raw = hexBytes(permit);
  if (raw === null) {
    return { format: 'unknown', fields: [], raw: typeof permit === 'string' ? permit : '' };
  }

  let len: number;
  try {
    len = size(raw);
  } catch {
    return { format: 'unknown', fields: [], raw };
  }

  try {
    switch (len) {
      case FULL_EIP2612:
        return { format: 'eip2612', fields: decodeEip2612Full(raw), raw };
      case FULL_DAI:
        return { format: 'dai', fields: decodeDaiFull(raw), raw };
      case FULL_PERMIT2:
        return { format: 'permit2', fields: decodePermit2Full(raw), raw };
      // Compact (packed) forms: recognized by length; decoding their non-aligned
      // layout is deferred, so they surface format + raw with no decoded fields.
      case COMPACT_EIP2612:
        return { format: 'eip2612', fields: [], raw };
      case COMPACT_DAI:
        return { format: 'dai', fields: [], raw };
      case COMPACT_PERMIT2:
        return { format: 'permit2', fields: [], raw };
      // 1inch on-wire forms: 20-byte token address prefix + a bare payload. Strip
      // the token, decode the remainder against its branch, prepend a Token field.
      case PREFIXED_EIP2612:
        return prefixed('eip2612', raw, decodeEip2612Full);
      case PREFIXED_DAI:
        return prefixed('dai', raw, decodeDaiFull);
      case PREFIXED_PERMIT2:
        return prefixed('permit2', raw, decodePermit2Full);
      case PREFIXED_COMPACT_EIP2612:
        return prefixed('eip2612', raw, null);
      case PREFIXED_COMPACT_DAI:
        return prefixed('dai', raw, null);
      case PREFIXED_COMPACT_PERMIT2:
        return prefixed('permit2', raw, null);
      default:
        return { format: 'unknown', fields: [], raw };
    }
  } catch {
    // Right length but the bytes don't decode against the layout: honest raw.
    return { format: 'unknown', fields: [], raw };
  }
}

/**
 * Handle a `token(20) ++ payload` permit: strip the leading 20-byte token
 * address (first 40 hex chars after `0x`), decode the remainder with `decode`
 * (or skip for compact/packed remainders where `decode` is null), and prepend a
 * `Token` field carrying the token as a lowercase `0x…` string. permit.ts does
 * NOT call the chain — the snap formats/resolves the address downstream.
 */
function prefixed(
  format: Exclude<PermitDecoded['format'], 'unknown'>,
  raw: Hex,
  decode: ((rest: Hex) => PermitDecoded['fields']) | null,
): PermitDecoded {
  const token = ('0x' + raw.slice(2, 42)) as Hex;
  const rest = ('0x' + raw.slice(42)) as Hex;
  const tokenField = { label: 'Token', value: token as string };
  const fields = decode ? [tokenField, ...decode(rest)] : [tokenField];
  return { format, fields, raw };
}
