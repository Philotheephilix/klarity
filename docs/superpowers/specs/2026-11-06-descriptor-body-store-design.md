# Descriptor Body Store — Design

**Date:** 2026-11-06
**Status:** awaiting approval
**Supersedes:** the ethswarm/Swarm body-store design (dropped — see "Why not Swarm")

## Empirical sizing (live registry, measured 2026-11-06)

Ran all 746 non-test descriptors (the exact set `walkDescriptors` ingests —
`tests`/`testsv2`/`sigs` dirs and `*.tests.json` / `common-*.json` excluded)
through Klarity's own `normalizeDescriptor` and canonicalized every emitted
`formatBlock` slice:

- 16,364 rows produced, 0 normalize failures.
- **Largest single `formatBlock` slice: 6,398 bytes (~6.4 KB)**
  (`registry/morpho/calldata-MidnightBundlesV2.json`).
- Median slice: 520 bytes. Rows over the ~129.5 KB entity cap: **0 / 16,364**.
- The big *files* (LiFi 230 KB) decompose into thousands of tiny per-row
  slices (LiFi → 3,960 rows); the 286 KB file is a skipped test file.

The max real per-row body is ~20× under the Arkiv entity cap. The `bytes`
column has vast headroom; the pre-flight size guard will essentially never
fire. This is the data the design is built on.

## Intent & why

Today Klarity mirrors the ERC-7730 registry into Arkiv as a flattened,
queryable index. The full descriptor body (`EntityRecord.formatBlock`) is
computed by the normalizer but **dropped at write time** — only the short
indexed columns + a `contentHash` reach Arkiv. So a query can find a
descriptor but can't retrieve the raw ERC-7730 body it points at.

This change stores the full descriptor body **as a non-indexed `bytes`
column in the same Arkiv entity.** A single-descriptor read returns the row
*and* the inlined body; browse/list reads are unchanged.

Result: the raw ERC-7730 body becomes retrievable alongside the index, with
no second storage system.

## Why not Swarm (the reversal)

An earlier version of this design offloaded the body to ethswarm (Bee),
storing only a `swarmRef` in Arkiv. That was built on the belief that Arkiv
couldn't hold a body. An Opus agent then measured the real limits on live
Rabdi (chain 7794095), binary-searching the boundary with throwaway
on-chain writes:

- Per-`str` column cap: **128 bytes** (hard, client-side, every str column).
- Per-entity cap: **~129.5 KB** total encoded bytes (succeeds ≤129,500 B,
  fails ≥129,750 B with "Execution error without revert data" at the chain).
- A non-indexed **`bytes`** column round-trips a payload byte-exact; 100 KB
  verified.

The maintainer's "1 MB max entity" was wrong for Rabdi, but the real
~129.5 KB cap is still far above a typical ERC-7730 body (1–50 KB). So the
body fits in Arkiv directly. Swarm would add a funded Bee node, a postage
batch, real xBZZ spend, a second failure domain, and a dereference round-trip
— all to solve a problem Arkiv doesn't actually have at this scale. Dropped.

## Goals

- Store the full per-row `formatBlock` slice as a non-indexed `bytes` column
  on every write (create, update, backfill, sync).
- Store a per-row `bodyHash` (non-indexed) = `descriptorHash(formatBlock)`
  for integrity verification of that specific row's body.
- Single-descriptor reads inline the body (decoded from `bytes` → JSON),
  after verifying it hashes to the row's `bodyHash`.
- Browse/list reads are unchanged — they do **not** select or return the
  body or bodyHash columns (keeps rows small and list responses lean).
- Fail loud if a body would exceed the Arkiv entity cap, rather than writing
  a truncated or index-only row.
- **Recover the 27.6% of records (4,523 / 16,364) dropped today** by the
  128-byte indexed-str cap. The full signature already lives in the body, so
  no row needs to be dropped for an oversized signature. (See decision 7.)

## Non-goals

- No external blob store (no Swarm/Bee/IPFS). If a single body ever
  approaches ~128 KB this design is revisited — not before.
- No change to the EIP-712 signed-write security gate, the allowlist, the
  nonce replay set, or the fork-flow PR write-back.
- No migration tool for already-written rows. Live entities from prior
  sessions predate the body column; they keep working for index queries and
  have no body to inline until re-synced. A backfill re-run repopulates them
  (the body column changes the record, so the hash loop-guard re-writes).

## Anti-goals

- Browse must never return bodies. A single-descriptor read inlines exactly
  one body; list endpoints stay body-free. (A future opt-in `?inline=` flag
  would be out of scope here.)
- Klarity must not silently write a row whose body was dropped or truncated.
  Over-cap body → the whole upsert fails loud.

## Decisions made (my calls)

1. **Body as a non-indexed `bytes` column, in the same entity.** One store,
   one write, one read. The ~129.5 KB entity cap is the only ceiling and
   it's far above typical bodies. (User chose "bytes column in Arkiv" over
   Swarm-always and a hybrid, 2026-11-06.)
2. **Store the per-row `formatBlock` SLICE, with its OWN `bodyHash` column.**
   The builder-check caught that the existing `contentHash` is computed over
   the *whole source document* (`descriptorHash(content)` in import/sync/write)
   and is *shared across all N rows a file produces* — so it cannot verify a
   single row's slice. Instead each row stores
   `bodyHash = descriptorHash(formatBlock)` (same canonical-JSON + keccak256
   path, reusing `descriptorHash` verbatim on the slice). The file-level
   `contentHash` stays exactly as-is for provenance / the sync loop-guard.
   (User chose "Slice + per-body hash", 2026-11-06.)
3. **Body serialized as RFC 8785 JCS canonical JSON, UTF-8, stored as
   `bytes`.** The canonical form is `canonicalize(formatBlock)` — the same
   string `descriptorHash(formatBlock)` hashes — so write-time produces the
   bytes and the bodyHash from one canonicalization. Read path: unwrap the
   `bytes` value (it returns as a **hex string**, `BytesValue =
   Value<"bytes", Hex>`, NOT a `Uint8Array`), hex→bytes→UTF-8→`JSON.parse`.
4. **Verify `bodyHash` on single-descriptor read.** After decoding, recompute
   `descriptorHash(parsedBody)` and compare to the row's stored `bodyHash`;
   mismatch → 500, don't serve a corrupted body. Defense in depth; cheap
   because the hash path already exists.
5. **Only the single-descriptor endpoint selects body/bodyHash.** Browse
   builders omit both from their `select`, so list queries never pull body
   bytes over the wire.
6. **Pre-flight size guard using the SDK's own primitives.** The SDK exports
   `MAX_ENTITY_BYTES` / `MAX_BYTES_LENGTH` (131072) and throws
   `EntityTooLargeError`. Prefer catching/propagating that over inventing a
   constant; if a pre-flight check is kept, gate body byte length against a
   conservative fraction of `MAX_ENTITY_BYTES`, citing the measured ~129.5 KB
   real-chain ceiling. Fail loud naming the descriptor — never write an index
   row with a dropped body. (With the 6.4 KB real max, belt-and-suspenders.)
7. **Resolve the 27.6% over-cap drop — different fix per field.** Today
   `recordExceedsStringCap` (`src/sync.ts:78`) drops the WHOLE entity if
   `functionSignature`, `functionName`, or `eip712PrimaryType` exceeds 128 B.
   Measured: 4,523 rows (27.6%) dropped, driven by `functionSignature`.
   - **`functionSignature`: dropped as an Arkiv column entirely.** It isn't
     mandatory to index — only the browse endpoint filtered on it, and
     `selector` (4-byte, always indexed, never over-cap) is the canonical
     identity for the same function. The full signature is in the body. This
     alone recovers 96.46%. (User, 2026-11-06.)
   - **`functionName` + `eip712PrimaryType`: keep indexed, OMIT the field
     when >128 B** (don't drop the row). The residual 579 rows are EIP-712
     descriptors whose names are long type strings; short calldata names stay
     query-able, long ones fall back to the body. Net: **0% dropped.**
   The old `recordExceedsStringCap` whole-row guard is removed; `toValues`
   omits any individual still-capped field (`functionName`/`eip712PrimaryType`)
   via the existing optional-column mechanism.

## The how

### Schema: `src/arkiv/schema.ts`

**Remove** the `functionSignature` column (decision 7): delete it from
`defineSchema`, from `INDEXED_ATTRIBUTES`, and from `toValues`. The
`QueryFilter` and `BROWSE_FILTER_KEYS` entries for it go too (see Writer/Read).

**Make `functionName` optional** (currently required): change
`functionName: str().indexed()` → `str().indexed().optional()`, and in
`toValues` move it into the conditional block alongside `eip712PrimaryType`,
written only when present AND ≤128 B. `eip712PrimaryType` is already optional;
add the same ≤128 B guard. (A tiny `fitsStrCap(s)` helper = `utf8Bytes(s) ≤ 128`.)

**Add two non-indexed columns:**
```
body: bytes(),       // RFC 8785 JCS canonical JSON of the per-row formatBlock, UTF-8
bodyHash: str(),     // descriptorHash(formatBlock) = 0x… keccak256 (66 chars, ≤128B)
```
`bytes` is never indexable (`IndexableValue = Exclude<ArkivValue, BytesValue>`)
— correct here, the body is retrieved by identity, never queried on. Neither
new column is added to `INDEXED_ATTRIBUTES`. `bodyHash` is a `str` (0x-prefixed
66-char hash, well under the 128-byte cap) — non-indexed, nothing queries on it.
`toValues(rec, meta)` canonicalizes `rec.formatBlock` ONCE into a string `c`,
then emits `body: bytes(utf8Encode(c))` and
`bodyHash: str(descriptorHash(rec.formatBlock))`. `WriteMeta` needs no Swarm
field; the slice + hash derive from `rec.formatBlock` (thread the canonical
string through if avoiding a second canonicalize is cheap).

**`OPTIONAL_COLUMNS`** (in `client.ts`, used by patch to `unset` absent cols)
gains `functionName` so a row that later fits re-adds it and one that stops
fitting clears it. Keep `eip712PrimaryType`; drop `functionSignature`.

### Writer: `src/arkiv/client.ts`

- Remove `functionSignature` from the `QueryFilter` type, `buildPredicates`,
  and the `select` projection.
- `queryManyBuilder`'s `select` **does not** add `body`/`bodyHash` —
  browse/identity-list stays body-free.
- A new `queryOneWithBody(identity)` (or a flag on `queryOne`) adds
  `body: true, bodyHash: true` to the select for the single-descriptor path.
- `upsert` is unchanged in shape; `toValues` now emits `body`+`bodyHash` and
  omits over-cap `functionName`/`eip712PrimaryType`. The pre-flight size guard
  (decision 6) lives here or in shared writer glue, before the chain call.

### Read: `src/routes/query.ts`

- Remove `functionSignature` from `BROWSE_FILTER_KEYS`.
- `GET /descriptors/:chainId/:address/:selector` — use the body-selecting
  query. If the row has `body`, unwrap it (the `{type:'bytes', value}` value
  is a **hex string** `0x…`), hex→bytes→UTF-8 string→`JSON.parse`, then verify
  `descriptorHash(parsedBody) === row.bodyHash` (unwrap the `bodyHash` str),
  attach as `row.formatBlock`, return. Missing body (pre-column row) → return
  the index row with no `formatBlock`, not an error. Decode or hash mismatch
  → 500.
- `GET /descriptors/:chainId/:address` and `GET /descriptors` — unchanged,
  body/bodyHash never selected.

### Importer & sync: `src/import.ts`, `src/sync.ts`

No new dependency. The body already lives on `rec.formatBlock`; `toValues`
now persists it plus `bodyHash`. **Remove the whole-row `recordExceedsStringCap`
guard** (`sync.ts` and wherever `import.ts` calls it) — over-cap rows now
WRITE, with the offending indexed field omitted by `toValues`. The
`oversizedRecords` summary counter can stay (now counts rows that had a field
omitted, not rows dropped) or be renamed `fieldsOmitted` — builder's call. The
new per-entity body-size guard (decision 6) replaces it as the only hard stop.
`ImportDeps` is unchanged (no Swarm client).

### Config & server: `src/config.ts`, `src/server.ts`

No new config, no new client, no new `ServerDeps` field. (This is strictly
less wiring than the Swarm design.)

## What's left to the builder

- Exact SDK call shape for a `bytes()` column value in `toValues` and for
  unwrapping it from a query row. Confirmed: the row returns
  `{type:'bytes', value:<hex string>}` (`BytesValue = Value<"bytes", Hex>`) —
  decode the hex, not a `Uint8Array`.
- Whether to keep an explicit pre-flight size guard at all, or just
  catch/propagate the SDK's `EntityTooLargeError` (SDK exports
  `MAX_ENTITY_BYTES`/`MAX_BYTES_LENGTH` = 131072). With the 6.4 KB real max
  the guard essentially never fires; a thin propagate-with-descriptor-name is
  enough. If a numeric gate is added, reserve headroom under the measured
  ~129.5 KB real-chain ceiling and comment the source of the number.
- Whether `toValues` recomputes canonical JSON or receives it from the hash
  step (avoid double canonicalization if cheap to thread through).

## Review focus (inputs the tasks must pin)

- A descriptor whose body exceeds the cap → upsert fails loud with a typed
  error naming the descriptor, and **no** index row is written. (Synthetic
  oversized body in a test, since no real body comes close.)
- A row written before the `body` column existed, read via the
  single-descriptor endpoint → returns the index row with no `formatBlock`
  (not a 500, not a hang).
- `bodyHash` mismatch between the decoded body and the row's stored hash →
  refuse to serve (500), don't return a corrupted body.
- Browse/list endpoints never select body/bodyHash — verify the `select`
  shape, and that a list response carries no body bytes.
- Oversized **indexed** `str` field still dropped/guarded by the existing
  128-byte logic — the body column doesn't change the indexed-column cap.
- Body round-trips byte-exact: write a known body, read it back, assert deep
  equality of the parsed JSON and that `descriptorHash` matches. Use the
  real 6.4 KB max slice (`morpho/calldata-MidnightBundlesV2.json`) as a
  fixture so the largest real case is pinned.
