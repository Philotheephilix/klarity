# Phase 2 — Schema validated against the full registry

Ran a normalizer simulation over **every** descriptor in a fresh clone of
`ethereum/clear-signing-erc7730-registry` (cloned to `vendor/`, script at
`scripts/analyze.mjs`, keccak via `js-sha3`, verified: `transfer(address,uint256)`
→ `0xa9059cbb`). Goal: confirm 100% of current clear-signing JSON passes the
Klarity normalizer, and find every structural case.

## Headline result

After correct exclusions, **100% of real descriptors normalize with zero errors.**

| Metric | Value |
|---|---|
| Emit-candidate descriptors | **740** (612 calldata + 128 eip712) |
| Include-fragments (`common-*.json`) | 22 (resolved into others, never emitted directly) |
| Excluded non-descriptors | 169 `sigs/` signed fixtures + all `tests/` vectors |
| Schema version | **v2 only** — 0 v1 descriptors (v1 refs were test schemas) |
| `kind=unknown` after resolve | **0** |
| Missing/empty deployments | **0** / 0 |
| Non-`0x40` addresses | **0** |
| Non-numeric chainIds | **0** |
| Selector derivation failures | **0** |
| Non-signature calldata format keys | **0** |
| eip712 with no derivable primaryType | **0** |
| Zero formats after include-resolve | **0** |
| Entities that would be written to Arkiv | **~16,364** |

## Edge cases found (and how the spec now handles each)

### 1. `sigs/` directories are NOT descriptors — exclude them
169 files under `registry/<org>/sigs/*.json` are **signed EIP-712 test fixtures**
(shape: `{ "sig": { domain, primaryType, message, types, signature:{v,r,s} } }`),
consumed by the registry's `tester`. They have no `context`/`display`. They were
the entire `noSchema: 169` count in the first pass.
→ **Normalizer excludes `sigs/`, `tests/`, `testsv2/` dirs and `*.tests.json`.**

### 2. `common-*.json` are include-targets, not standalone descriptors
22 `common-*.json` files (e.g. `1inch/common-AggregationRouterV6.json`,
`permit/common-dai-permit.json`) carry shared `display`/`context` fragments with
no deployments of their own. They must be *resolved into* other files, never
emitted as entities directly.
→ **Normalizer treats `common-*.json` (and `ercs/*`) as include-sources only;
they are skipped as emit-sources but loaded when referenced via `includes`.**

### 3. `includes` is the majority path (not an edge case)
**475 / 740 descriptors (64%) use `includes`**, max chain depth **2**
(108 files resolve through 2 levels). A partial file like
`permit/eip712-permit-arbitrum-dai.json` has *no* `display.formats` of its own —
all of it comes from `ercs/eip712-erc2612-permit.json`.
→ **Include-resolution is recursive + deep-merged BEFORE flattening (already in
spec). Confirmed: resolver fetches fragment, deep-merges self over fragment,
recurses; cache per fragment path. Zero files produce empty formats after this.**

### 4. `$ref` field pointers into `display.definitions` — MUST be preserved
**472 / 740 descriptors use `display.definitions`**, and **65 files** have
`fields[]` entries that reference them via a JSON pointer:
```json
{ "path": "baseRequest.minReturnAmount",
  "$ref": "$.display.definitions.minReceiveAmount",
  "params": { "tokenPath": "baseRequest.toToken" } }
```
If we store a function's `format` block verbatim but drop the sibling
`definitions`, every `$ref` dangles and a consumer can't resolve the field.
→ **SPEC CHANGE: the normalizer inlines each `$.display.definitions.X` reference
into the field (merging the definition's keys, with the field's own keys winning)
before storing. The stored payload is self-contained — no `$ref` left dangling,
no external `definitions` lookup needed by the consumer.** (Alternative — carry
the whole `definitions` block in each payload — rejected: bigger payloads,
pushes resolution onto every consumer.)

### 5. High deployment fan-out is normal
Deployment counts per file range 1–**177** (`safe/eip712-Safe-Multisig.json` is on
177 chains). Median is 1 (581 files), but the long tail (42, 46, 65, 177…) means
one descriptor can emit **hundreds** of entities.
→ **Per-deployment flattening is correct; sizing note for the importer: ~16.4k
entities on backfill, so batch writes + rate-limit awareness matter (flagged in
`friction.md` as a wanted Arkiv batch-write primitive).**

### 6. `chainId` is a JSON number; addresses are mixed-case
All deployment `chainId`s are numbers (→ `u64`), all addresses match `0x[0-9a-fA-F]{40}`
but in mixed EIP-55 case.
→ **Normalizer lowercases `contract` on store and in all query keys (already in
spec); stores `chainId` as `u64`.**

## Net spec deltas applied
- Exclusion rule for `sigs/` + `common-*` emit-sources → `plan.md` normalizer.
- `$ref`→`definitions` inlining step → `plan.md` normalizer + `arkiv/schema.md`
  payload description.
- v2-only confirmed; v1 handling explicitly out of scope (none exist).
- Backfill scale (~16.4k entities, up to 177 deployments/file) noted for batching.

## Reproduce
```
git clone --depth 1 https://github.com/ethereum/clear-signing-erc7730-registry vendor/...
cd scripts && npm i js-sha3
node scripts/analyze.mjs <registry-root> <ercs-root>   # prints JSON stats + examples
```
Raw output: `docs/research/analysis-raw.json`.
