import { defineSchema, addr, u64, str, bytes } from '@arkiv-network/sdk/schema';
import type { ArkivValue } from '@arkiv-network/sdk';
import type { EntityRecord } from '../normalize/types.js';
import { canonicalHash } from '../hash.js';

/** The one registry namespace. Every Klarity entity is tagged with it. */
export const SCHEMA_NAMESPACE = 'clear-signing-erc7730' as const;

/**
 * The `ClearSignDescriptor` entity — one per flattened
 * (chainId, contract, selector/eip712PrimaryType) descriptor row.
 *
 * Indexing follows the installed SDK's rules, which differ from a naive reading
 * of `arkiv/schema.md`:
 * - `bytes` columns can NEVER be indexed/filtered in this SDK (`bytes()` has no
 *   `.indexed()`; `IndexableValue = Exclude<ArkivValue, BytesValue>`). The
 *   headline lookup filters on `selector`, so `selector` is stored as an indexed
 *   `str` holding its `0x…` hex — queryable, which `bytes` would not be.
 * - `contentHash` is a read-back-only loop guard (never a query filter), so it
 *   stays a non-indexed `bytes` blob.
 * - `schemaVersion` is the only attribute schema.md marks non-indexed.
 */
export const ClearSignDescriptor = defineSchema(SCHEMA_NAMESPACE, {
  chainId: u64().indexed(),
  contract: addr().indexed(),
  // hex selector as an indexed str so the headline lookup can filter on it.
  selector: str().indexed(),
  functionName: str().indexed().optional(),
  kind: str().indexed(),
  intent: str().indexed(),
  entityName: str().indexed(),
  contractName: str().indexed(),
  owner: str().indexed(),
  sourcePath: str().indexed(),
  authorizedBy: addr().indexed().optional(),
  source: str().indexed(),
  eip712PrimaryType: str().indexed().optional(),
  // read-back only (loop guard / EIP-712 binding); bytes is never indexable.
  contentHash: bytes(),
  // the full canonical format block + its hash; neither is indexed or queried.
  body: bytes(),
  bodyHash: str(),
  schemaVersion: str(),
});

/** Attribute names that are indexed (i.e. usable in `.where(...)` filters). */
export const INDEXED_ATTRIBUTES = [
  'chainId',
  'contract',
  'selector',
  'functionName',
  'kind',
  'intent',
  'entityName',
  'contractName',
  'owner',
  'sourcePath',
  'authorizedBy',
  'source',
  'eip712PrimaryType',
] as const;

/** Provenance + content metadata the writer layer injects at upsert time. */
export interface WriteMeta {
  /** `github-sync` or `authorized-write`. */
  source: string;
  /** EF wallet that authorized the write (authorized-write only). */
  authorizedBy?: string;
  /** `descriptorHash(fullDescriptor)` — the one system hash, as `0x…`. */
  contentHash: string;
}

/**
 * Does `s` fit the SDK's 128-byte cap on an indexed `str` column? The cap is on
 * UTF-8 byte length, not character count, so multi-byte characters count more
 * than once. Over-cap values are omitted from the row rather than truncated.
 */
export function fitsStrCap(s: string): boolean {
  return new TextEncoder().encode(s).length <= 128;
}

/**
 * Build the Arkiv `values` row for a record. Every value is wrapped with its
 * column's type helper — no bare primitives reach `createEntity`/`patchEntity`.
 * Optional columns (`authorizedBy`, `eip712PrimaryType`) are omitted entirely
 * when absent rather than set to a sentinel. `functionName` and
 * `eip712PrimaryType` are also omitted when they exceed the 128-byte str cap;
 * the full descriptor always survives in the non-indexed `body` blob.
 */
export function toValues(
  rec: EntityRecord,
  meta: WriteMeta,
): Record<string, ArkivValue> {
  // Canonicalize the format block once: its bytes become the body blob and the
  // same canonical form is hashed into bodyHash.
  const { canonical, hash } = canonicalHash(rec.formatBlock);

  const values: Record<string, ArkivValue> = {
    chainId: u64(BigInt(rec.chainId)),
    contract: addr(rec.contract.toLowerCase()),
    selector: str(rec.selector),
    kind: str(rec.kind),
    intent: str(rec.intent),
    entityName: str(rec.entityName),
    contractName: str(rec.contractName),
    owner: str(rec.owner),
    sourcePath: str(rec.sourcePath),
    source: str(meta.source),
    contentHash: bytes(meta.contentHash as `0x${string}`),
    body: bytes(new TextEncoder().encode(canonical)),
    bodyHash: str(hash),
    schemaVersion: str(rec.schemaVersion),
  };

  if (meta.authorizedBy !== undefined && meta.authorizedBy !== '') {
    values.authorizedBy = addr(meta.authorizedBy.toLowerCase());
  }
  if (fitsStrCap(rec.functionName)) {
    values.functionName = str(rec.functionName);
  }
  if (
    rec.eip712PrimaryType !== undefined &&
    rec.eip712PrimaryType !== '' &&
    fitsStrCap(rec.eip712PrimaryType)
  ) {
    values.eip712PrimaryType = str(rec.eip712PrimaryType);
  }

  return values;
}
