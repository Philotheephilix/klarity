import canonicalizeModule from 'canonicalize';
import sha3 from 'js-sha3';

const canonicalize = canonicalizeModule as unknown as (input: unknown) => string | undefined;
const { keccak256 } = sha3;

/**
 * Canonicalize `doc` once and hash it, returning both the RFC 8785 (JCS)
 * canonical JSON string and its keccak256 `0x…` digest. Callers that need both
 * the canonical bytes (e.g. a body blob) and the hash use this to avoid
 * canonicalizing twice. `descriptorHash` is defined in terms of it, so the two
 * stay byte-identical for the same input.
 */
export function canonicalHash(doc: object): { canonical: string; hash: `0x${string}` } {
  const canonical = canonicalize(doc) as string;
  const bytes = new TextEncoder().encode(canonical);
  return { canonical, hash: `0x${keccak256(bytes)}` };
}

/**
 * Canonical content hash for the whole system.
 *
 * Algorithm: RFC 8785 (JCS) canonical JSON string of `doc`, then keccak256 over
 * its exact UTF-8 bytes, prefixed with `0x`. Deterministic regardless of JSON
 * key order. Used identically by the EIP-712 signature layer, the Arkiv writer,
 * and the sync loop-guard.
 */
export function descriptorHash(doc: object): `0x${string}` {
  return canonicalHash(doc).hash;
}
