import canonicalizeModule from 'canonicalize';
import sha3 from 'js-sha3';

// Browser port of the server's src/hash.ts — MUST stay byte-identical so a
// signature made here verifies there. Same packages (canonicalize = RFC 8785
// JCS, js-sha3 = keccak256), same UTF-8 encoding, same 0x prefix. If this drifts
// from the server, every write 400s on HASH_MISMATCH. The hash test pins it to a
// known vector (see web/test/descriptor-hash.test.ts).
const canonicalize = canonicalizeModule as unknown as (
  input: unknown,
) => string | undefined;
const { keccak256 } = sha3;

/**
 * Canonical content hash for a descriptor: RFC 8785 (JCS) canonical JSON, then
 * keccak256 over its exact UTF-8 bytes, 0x-prefixed. Deterministic regardless of
 * key order. Identical to the server's descriptorHash.
 */
export function descriptorHash(doc: object): `0x${string}` {
  const canonical = canonicalize(doc) as string;
  const bytes = new TextEncoder().encode(canonical);
  return `0x${keccak256(bytes)}`;
}
