import canonicalize from 'canonicalize';
import { keccak256 } from 'js-sha3';

/**
 * Canonical content hash for the whole system.
 *
 * Algorithm: RFC 8785 (JCS) canonical JSON string of `doc`, then keccak256 over
 * its exact UTF-8 bytes, prefixed with `0x`. Deterministic regardless of JSON
 * key order. Used identically by the EIP-712 signature layer, the Arkiv writer,
 * and the sync loop-guard.
 */
export function descriptorHash(doc: object): `0x${string}` {
  const canonical = canonicalize(doc) as string;
  const bytes = new TextEncoder().encode(canonical);
  return `0x${keccak256(bytes)}`;
}
