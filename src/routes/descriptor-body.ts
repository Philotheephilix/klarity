import { descriptorHash } from '../hash.js';
import sha3 from 'js-sha3';

const { keccak256 } = sha3;

/**
 * Decode and integrity-verify the non-indexed `body` column of a descriptor row.
 *
 * A `bytes` column reads back as `{ type:'bytes', value:<hex> }`. The body holds
 * the full ERC-7730 format block as hex-encoded canonical JSON; the sibling
 * `bodyHash` column is its keccak digest. This decodes hex → UTF-8 → JSON and
 * checks the parse against the stored hash.
 *
 * Returns the parsed object, or a discriminated failure the caller maps to a
 * 404 (`absent` — a pre-body row) or 500 (`decode`/`mismatch`).
 */
export type BodyResult =
  | { ok: true; formatBlock: Record<string, unknown> }
  | { ok: false; reason: 'absent' | 'decode' | 'mismatch' };

export function decodeBody(row: Record<string, unknown>): BodyResult {
  const body = row.body as { type: 'bytes'; value: string } | undefined;
  if (body === undefined || !body.value || body.value === '0x') {
    return { ok: false, reason: 'absent' };
  }
  let parsed: Record<string, unknown>;
  try {
    const json = Buffer.from(body.value.slice(2), 'hex').toString('utf8');
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'decode' };
  }
  const storedHash = (row.bodyHash as { type: 'str'; value: string } | undefined)?.value;
  if (descriptorHash(parsed) !== storedHash) {
    return { ok: false, reason: 'mismatch' };
  }
  return { ok: true, formatBlock: parsed };
}

/**
 * The 4-byte EIP-712 selector a descriptor is keyed by: `0x` + first 8 hex of
 * keccak256 over the primary type's full type-encoding string. Mirrors the
 * normalizer's `eip712Selector` exactly, so a reconstructed encodeType string
 * yields the same selector the mirror stored.
 */
export function eip712SelectorOf(typeEncoding: string): `0x${string}` {
  return `0x${keccak256(typeEncoding).slice(0, 8)}`;
}

/**
 * Reconstruct the EIP-712 `encodeType(primaryType)` string from a typed-data
 * `types` map, per the spec: the primary type's own encoding followed by every
 * referenced struct type, sorted by name. This is the exact string the registry
 * hashed to produce the stored selector.
 *
 * Returns `null` if `primaryType` is absent from `types`.
 */
export function encodeType(
  primaryType: string,
  types: Record<string, { name: string; type: string }[]>,
): string | null {
  if (!Array.isArray(types[primaryType])) return null;

  // Collect the primary type's transitive struct dependencies (excluding itself).
  const deps = new Set<string>();
  const visit = (name: string) => {
    const baseName = name.replace(/\[\d*\]$/, ''); // strip array brackets
    if (baseName === primaryType || deps.has(baseName) || !types[baseName]) return;
    deps.add(baseName);
    for (const field of types[baseName]) visit(field.type);
  };
  for (const field of types[primaryType]!) visit(field.type);

  const encodeOne = (name: string): string => {
    const fields = types[name]!.map((f) => `${f.type} ${f.name}`).join(',');
    return `${name}(${fields})`;
  };

  // Primary type first, then dependencies sorted alphabetically (EIP-712 rule).
  const sortedDeps = [...deps].sort();
  return encodeOne(primaryType) + sortedDeps.map(encodeOne).join('');
}
