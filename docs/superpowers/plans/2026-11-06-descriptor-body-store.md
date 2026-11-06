# Descriptor Body Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store each descriptor's full `formatBlock` as a non-indexed `bytes` column in Arkiv, drop the `functionSignature` column, and stop dropping over-cap rows — so a single-descriptor read returns the raw ERC-7730 body and 100% of the 16,364 registry records write (up from 72.4%).

**Architecture:** Add two non-indexed columns (`body` bytes, `bodyHash` str) to the existing `ClearSignDescriptor` schema. `toValues` serializes `rec.formatBlock` to RFC 8785 canonical JSON once, writes it as `bytes` and its keccak256 as `bodyHash`, and omits any indexed `str` field that exceeds 128 bytes (`functionName`, `eip712PrimaryType`) instead of dropping the whole row. `functionSignature` is removed as a column entirely (the 4-byte indexed `selector` is the canonical identity; the full signature lives in the body). The single-descriptor read endpoint decodes the body, verifies the hash, and inlines it as `formatBlock`. The whole-row `recordExceedsStringCap` guard is deleted from both writer paths.

**Tech Stack:** TypeScript (NodeNext ESM, `.js` relative imports), `@arkiv-network/sdk` v1.0.1, Fastify, vitest, `canonicalize` + `js-sha3` (via existing `src/hash.ts`).

**Spec:** `docs/superpowers/specs/2026-11-06-descriptor-body-store-design.md`

## Global Constraints

- NodeNext ESM: every relative import ends in `.js`. Build gate for every task: `npx tsc --noEmit` exits 0, AND `npm run build` then load the built `dist` module to confirm it resolves.
- `.env` and the private key must never be read, printed, or committed. No live Arkiv write (`upsert`/`createEntity`/`patchEntity`/`remove`) is run by the implementer — the live integration test (`client.int.test.ts`) is gated on `ARKIV_PRIVATE_KEY` and skips cleanly without it; leave it gated, do not run it.
- Arkiv `str` columns hard-cap at 128 UTF-8 bytes (client-side). `bytes` columns are never indexable (`IndexableValue = Exclude<ArkivValue, BytesValue>`) and read back as a **hex string** (`BytesValue = Value<"bytes", Hex>`), not a `Uint8Array`.
- `bytes(value)` accepts `Hex | Uint8Array`. Write the body as `bytes(new TextEncoder().encode(canonicalJson))`.
- `descriptorHash(doc)` (`src/hash.ts`) = RFC 8785 JCS canonical JSON + keccak256, `0x`-prefixed. Reuse it verbatim for `bodyHash`; do not reimplement hashing.
- The body/bodyHash columns are NOT added to `INDEXED_ATTRIBUTES` and NOT selected by any browse query.

## Review Focus

- A descriptor whose serialized body exceeds the ~129.5 KB entity cap → upsert fails loud naming the descriptor; no index row is written. (No real body is close — max is 6.4 KB — so this needs a synthetic oversized body in a test.) → Task 5.
- A row written before the `body` column existed, read via the single-descriptor endpoint → returns the index row with no `formatBlock` (not a 500, not a hang). → Task 4.
- `bodyHash` mismatch between decoded body and the row's stored hash → endpoint refuses to serve (500), does not return a corrupted body. → Task 4.
- Browse/list endpoints never select `body`/`bodyHash` → verify the `select` projection shape and that a list response carries no body bytes. → Task 2, Task 4.
- An over-cap `functionName`/`eip712PrimaryType` row now WRITES with that one field omitted (row not dropped); `functionSignature` is gone as a column → Task 1, Task 3.

---

### Task 1: Schema — body/bodyHash columns, drop functionSignature, omit over-cap str fields

**Files:**
- Modify: `src/arkiv/schema.ts`
- Test: `test/arkiv/schema.test.ts`

**Interfaces:**
- Consumes: `EntityRecord` (`src/normalize/types.ts`) — `formatBlock: Record<string, unknown>`, `functionName: string`, `eip712PrimaryType?: string`; `descriptorHash` (`src/hash.ts`).
- Produces:
  - `ClearSignDescriptor` schema gains `body: bytes()` and `bodyHash: str()`; loses `functionSignature`.
  - `INDEXED_ATTRIBUTES` loses `'functionSignature'`; gains nothing (body/bodyHash non-indexed).
  - `toValues(rec, meta)` now emits `body` + `bodyHash`, never emits `functionSignature`, and omits `functionName`/`eip712PrimaryType` when their UTF-8 length > 128.
  - New exported helper `fitsStrCap(s: string): boolean` = `new TextEncoder().encode(s).length <= 128`.

- [ ] **Step 1: Update the schema-shape tests**

In `test/arkiv/schema.test.ts`:
- In the "exact indexed attribute set" test, remove `'functionSignature'` from the `expected` array.
- Add a test: `ClearSignDescriptor.columns.body?.isIndexed` is `false` and `columns.bodyHash?.isIndexed` is `false`, and `columns.functionSignature` is `undefined`.
- Add a test: `columns.functionName?.isOptional` is `true` (it becomes optional).

- [ ] **Step 2: Update the toValues tests**

In `test/arkiv/schema.test.ts`:
- Remove the assertions that read `values.functionSignature`.
- Add a test: `toValues(calldataRec, …)` produces `values.body` matching `{ type: 'bytes' }` and `values.bodyHash` matching `{ type: 'str', value: descriptorHash(calldataRec.formatBlock) }`.
- Add a test: a record whose `functionName` is a 200-byte string (`'a'.repeat(200)`) produces `values.functionName === undefined` but still produces `values.body` and `values.selector`. Use the real `descriptorHash` import for the expected `bodyHash`.
- Add a test: an `eip712Rec` variant whose `eip712PrimaryType` is a 300-byte string produces `values.eip712PrimaryType === undefined` while `values.body` is present.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run test/arkiv/schema.test.ts`
Expected: FAIL (body/bodyHash undefined; functionSignature still present).

- [ ] **Step 4: Edit the schema definition**

In `src/arkiv/schema.ts`:
- Remove the `functionSignature: str().indexed()` line from `defineSchema`.
- Change `functionName: str().indexed()` → `functionName: str().indexed().optional()`.
- Add, after `eip712PrimaryType`: `body: bytes(),` and `bodyHash: str(),` (both non-indexed; place near `contentHash` with a one-line comment that neither is indexable/queried).
- Remove `'functionSignature'` from `INDEXED_ATTRIBUTES`.

- [ ] **Step 5: Edit toValues + add fitsStrCap**

In `src/arkiv/schema.ts`:
- Add and export `fitsStrCap(s: string): boolean`.
- In `toValues`: remove the `functionSignature: str(rec.functionSignature)` line from the base `values` object, and remove `functionName: str(rec.functionName)` from the base object.
- Canonicalize once: `const bodyJson = canonicalize(rec.formatBlock) as string;` — import `canonicalize` the same way `src/hash.ts` does (`import canonicalizeModule from 'canonicalize'`), OR call a new `src/hash.ts` helper (see note below). Emit `body: bytes(new TextEncoder().encode(bodyJson))` and `bodyHash: str(descriptorHash(rec.formatBlock))`.
- After the base object, in the conditional block: write `functionName` only when present and `fitsStrCap(rec.functionName)`; write `eip712PrimaryType` only when present and non-empty and `fitsStrCap(...)` (extend the existing condition).

Note (implementer's call, record as a Ruling): to avoid canonicalizing twice (once for `bodyJson`, once inside `descriptorHash`), you MAY add a small exported helper to `src/hash.ts` that returns `{ canonical, hash }`, and use it here. If you do, keep `descriptorHash` behavior byte-identical. If the double-canonicalize is cheap enough, skip the helper — the design permits either.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run test/arkiv/schema.test.ts`
Expected: PASS.

- [ ] **Step 7: Build gate**

Run: `npx tsc --noEmit` (expect exit 0), then `npm run build` and load `dist/arkiv/schema.js` to confirm `toValues` and `ClearSignDescriptor` export.

- [ ] **Step 8: Commit**

```bash
git add src/arkiv/schema.ts test/arkiv/schema.test.ts
git commit -m "feat(arkiv): add body/bodyHash columns, drop functionSignature, omit over-cap str fields"
```

---

### Task 2: Writer — drop functionSignature from client, add body-selecting query

**Files:**
- Modify: `src/arkiv/client.ts`
- Test: `test/arkiv/client.int.test.ts` (live, gated — adjust assertions only; do NOT run)

**Interfaces:**
- Consumes: `ClearSignDescriptor`, `toValues`, `WriteMeta`, `Identity` (unchanged shape).
- Produces:
  - `QueryFilter` loses `functionSignature`.
  - `buildPredicates` loses the `functionSignature` branch.
  - `queryManyBuilder`'s `select` loses `functionSignature`; gains neither `body` nor `bodyHash`.
  - New method `queryOneWithBody(identity: Identity): Promise<Record<string, unknown> | null>` — same as `queryOne` but its underlying select also pulls `body` and `bodyHash`.

- [ ] **Step 1: Edit QueryFilter + buildPredicates**

In `src/arkiv/client.ts`:
- Remove `functionSignature: string;` from the `QueryFilter` type.
- Remove the `if (filter.functionSignature !== undefined) …` line from `buildPredicates`.
- Remove `functionSignature: true,` from the `queryManyBuilder` `.select({…})`.

- [ ] **Step 2: Add a body-selecting builder + queryOneWithBody**

In `src/arkiv/client.ts`:
- Add a private builder that is the same as `queryManyBuilder` but with `body: true, bodyHash: true` added to the select. Factor the shared select object so the two builders cannot drift (one base select; the body builder spreads it plus the two extra keys).
- Add `async queryOneWithBody(identity: Identity)`: build predicates for the full identity, fetch `.limit(1)` (or `.limit(100)` and take `[0]` to match `queryOne`), return the first row or `null`. Pin `.createdBy(this.registryWallet)` exactly as the other reads do.
- `queryOne`, `queryMany`, `upsert`, `remove`, `keyFor` are otherwise unchanged (they go through `toValues`, which now emits body/bodyHash on every write automatically).

- [ ] **Step 3: Update the gated live test's assertions (do not run)**

In `test/arkiv/client.int.test.ts`: remove any assertion that reads back `functionSignature`; where the test reads back a row, add an assertion path for `queryOneWithBody` returning `body`/`bodyHash`. Leave the `ARKIV_PRIVATE_KEY` skip guard intact. This test stays skipped in CI and for the implementer.

- [ ] **Step 4: Build gate**

Run: `npx tsc --noEmit` (exit 0), then `npm run build` and load `dist/arkiv/client.js` to confirm `ArkivClient` exports and `queryOneWithBody` is a function on the prototype.

- [ ] **Step 5: Commit**

```bash
git add src/arkiv/client.ts test/arkiv/client.int.test.ts
git commit -m "feat(arkiv): drop functionSignature from client, add queryOneWithBody"
```

---

### Task 3: Sync + import — remove the whole-row over-cap drop

**Files:**
- Modify: `src/sync.ts`, `src/import.ts`
- Test: `test/sync.test.ts`, `test/import.test.ts`

**Interfaces:**
- Consumes: `toValues`'s new omit behavior (Task 1) — an over-cap field is dropped per-field at write time, so the per-record whole-row guard is no longer needed.
- Produces: `recordExceedsStringCap`, `CAPPED_STRING_FIELDS`, and the `summary.oversizedRecords` increment are removed. `MAX_STRING_BYTES` and `utf8Bytes` may stay (they document the cap) or go — implementer's call; if `recordExceedsStringCap` is the only consumer of `CAPPED_STRING_FIELDS`, remove both. The re-export at `import.ts` bottom drops `recordExceedsStringCap`.

- [ ] **Step 1: Update the sync guard tests**

In `test/sync.test.ts`: the two guard cases currently assert that an over-cap `functionSignature`/`functionName` record is dropped (`oversizedRecords` incremented, row not written). Change them to assert the OPPOSITE: a record with a 200-byte `functionName` is now UPSERTED (the mocked `arkiv.upsert` is called for it), and the file outcome is `'written'`. Keep the eip712-collision guard test unchanged. Remove references to `oversizedRecords` where that counter is deleted.

- [ ] **Step 2: Update the import guard tests**

In `test/import.test.ts`: same change — an over-cap record is now imported (upsert called), not skipped. Adjust expected counts. Remove `oversizedRecords` assertions if the field is dropped.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run test/sync.test.ts test/import.test.ts`
Expected: FAIL (guard still drops the row).

- [ ] **Step 4: Remove the guard from sync.ts**

In `src/sync.ts`: delete `CAPPED_STRING_FIELDS`, `recordExceedsStringCap`, and the GUARD 1 block in `applyChangedFile` (the `if (recordExceedsStringCap(rec)) { … continue; }`). Decide on `oversizedRecords` in `IngestSummary` + its initializers (remove, or repurpose with a comment). Keep GUARD 2 (eip712 collision) and the `wrote === 0` hash-advance logic.

- [ ] **Step 5: Remove the guard from import.ts**

In `src/import.ts`: remove the `recordExceedsStringCap`/`MAX_STRING_BYTES` import (line 13), the GUARD 1 block (lines ~204-212), the `oversizedRecords` field + initializer, and the bottom re-export (line ~382). Keep GUARD 2 and the `wrote === 0` logic.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run test/sync.test.ts test/import.test.ts`
Expected: PASS.

- [ ] **Step 7: Build gate**

Run: `npx tsc --noEmit` (exit 0; catches any dangling import of the removed symbols), then `npm run build` and load `dist/sync.js` + `dist/import.js`.

- [ ] **Step 8: Commit**

```bash
git add src/sync.ts src/import.ts test/sync.test.ts test/import.test.ts
git commit -m "feat(sync): write over-cap rows with field omitted instead of dropping"
```

---

### Task 4: Read route — inline + verify body on single-descriptor read

**Files:**
- Modify: `src/routes/query.ts`
- Test: `test/server.test.ts` (or wherever the query routes are tested — locate with `grep -rln "descriptors/:chainId" test/`)

**Interfaces:**
- Consumes: `arkiv.queryOneWithBody` (Task 2), `descriptorHash` (`src/hash.ts`).
- Produces: `GET /descriptors/:chainId/:address/:selector` returns the row with a decoded `formatBlock` when a body is present; the two browse endpoints are unchanged. `BROWSE_FILTER_KEYS` loses `functionSignature`.

- [ ] **Step 1: Write the failing tests**

In the query-route test file, add cases (mock `arkiv.queryOneWithBody`):
- body present + hash matches → response includes `formatBlock` deep-equal to the original object; status 200.
- body present + hash mismatch (stored `bodyHash` differs from `descriptorHash(decoded)`) → status 500.
- row present but no `body` field (pre-column row) → status 200, response has the index fields and NO `formatBlock` (not a 500).
- row is `null` → 404 (unchanged).
- A browse request with `?functionSignature=…` → that key is ignored (not passed to `queryMany`); a browse response carries no `body`/`bodyHash` key.

Encode the body in the mock the way Arkiv returns it: `{ type: 'bytes', value: <0x-hex of UTF-8 canonical JSON> }` and `bodyHash` as `{ type: 'str', value: descriptorHash(obj) }`. Build the hex with `'0x' + Buffer.from(canonicalize(obj), 'utf8').toString('hex')`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run <query-route test file>`
Expected: FAIL (endpoint uses `queryOne`, no decode).

- [ ] **Step 3: Implement the decode + verify in the single-descriptor handler**

In `src/routes/query.ts`, the `:chainId/:address/:selector` handler:
- Call `arkiv.queryOneWithBody({…})` instead of `queryOne`.
- `null` → `reply.notFound` (unchanged).
- Unwrap `body` (it is `{ type:'bytes', value }` or absent). If absent/empty → return the row as-is (no `formatBlock`).
- If present: the `value` is a hex string. Decode: `Buffer.from(value.slice(2), 'hex')` → `.toString('utf8')` → `JSON.parse`. Unwrap `bodyHash` (`{ type:'str', value }`). Compute `descriptorHash(parsed)`; if it `!==` the stored `bodyHash` value → `reply.internalServerError('body hash mismatch')` (500). On match, set `row.formatBlock = parsed` and return `row`.
- Wrap the decode/parse in try/catch → malformed body is a 500, not an unhandled throw.

- [ ] **Step 4: Remove functionSignature from BROWSE_FILTER_KEYS**

In `src/routes/query.ts`: delete `'functionSignature',` from `BROWSE_FILTER_KEYS`. The browse handlers are otherwise unchanged and never select body/bodyHash (they go through `queryMany`, whose builder has no body columns).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run <query-route test file>`
Expected: PASS.

- [ ] **Step 6: Build gate**

Run: `npx tsc --noEmit` (exit 0), then `npm run build` and load `dist/routes/query.js` to confirm `registerQueryRoutes` exports.

- [ ] **Step 7: Commit**

```bash
git add src/routes/query.ts test/<query-route test file>
git commit -m "feat(api): inline and verify descriptor body on single-descriptor read"
```

---

### Task 5: Body round-trip + oversized-body guard, with the real 6.4 KB fixture

**Files:**
- Create: `test/arkiv/body.test.ts`
- Modify: `src/arkiv/schema.ts` (size guard, only if not already covered by the SDK's `EntityTooLargeError`)
- Test fixture: the real largest body (`registry/morpho/calldata-MidnightBundlesV2.json`'s largest emitted `formatBlock`)

**Interfaces:**
- Consumes: `toValues`, `descriptorHash`, the decode path mirrored from Task 4.
- Produces: a test proving the largest real body round-trips byte-exact and that an oversized body fails loud.

- [ ] **Step 1: Capture the real 6.4 KB fixture**

Generate the largest real `formatBlock` by running the built normalizer over `registry/morpho/calldata-MidnightBundlesV2.json` and writing the single largest emitted slice to `test/fixtures/largest-body.json`. (A throwaway `.mjs` under `/tmp` may produce it; commit only the resulting JSON fixture, not the script.)

- [ ] **Step 2: Write the round-trip test**

In `test/arkiv/body.test.ts`:
- Load the fixture. `const values = toValues(recWithThatFormatBlock, { source:'github-sync', contentHash: CONTENT_HASH })`.
- Assert `values.bodyHash.value === descriptorHash(fixture)`.
- Take `values.body` (a `{type:'bytes', value:Uint8Array|Hex}` — `bytes()` stores what you passed). Simulate the read path: produce the hex Arkiv would return (`'0x'+Buffer.from(canonicalize(fixture)).toString('hex')`), decode hex→utf8→`JSON.parse`, assert deep-equal to the fixture AND `descriptorHash(decoded) === values.bodyHash.value`.

- [ ] **Step 3: Write the oversized-body test**

In `test/arkiv/body.test.ts`: build a synthetic `formatBlock` whose canonical JSON exceeds the entity cap (e.g. a field with `'x'.repeat(140000)`). Assert that the write path fails loud — either `toValues` + a size guard throws a typed error naming the descriptor, OR (if relying on the SDK) that `bytes()`/the entity encode throws `EntityTooLargeError`. Pick one mechanism in Step 4 and assert exactly it.

- [ ] **Step 4: Decide and implement the size guard**

In `src/arkiv/schema.ts` (or writer glue): per design decision 6, either (a) add a pre-flight check — if the body's UTF-8 byte length exceeds a conservative fraction of `MAX_ENTITY_BYTES` (cite the measured ~129.5 KB ceiling in a comment), throw an error naming `rec.chainId/contract/selector`; or (b) document that the SDK's `EntityTooLargeError` is the guard and the test asserts that. With the 6.4 KB real max this is belt-and-suspenders; a thin pre-flight throw is the simpler, testable choice. Record the choice as a Ruling.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/arkiv/body.test.ts`
Expected: PASS.

- [ ] **Step 6: Build gate + full suite**

Run: `npx tsc --noEmit` (exit 0), `npm run build`, then `npx vitest run` (whole suite green, live int test skipped).

- [ ] **Step 7: Commit**

```bash
git add src/arkiv/schema.ts test/arkiv/body.test.ts test/fixtures/largest-body.json
git commit -m "test(arkiv): body round-trip with real 6.4KB fixture + oversized-body guard"
```

---

### Task 6: Whole-registry drop-count verification

**Files:**
- Create: `test/registry-coverage.test.ts` (or a committed measurement script with an assertion)

**Interfaces:**
- Consumes: the built normalizer + `toValues` + `fitsStrCap`.
- Produces: proof that 0 rows are now dropped (was 4,523 / 16,364).

- [ ] **Step 1: Write the coverage assertion**

Walk the same descriptor set the importer ingests (reuse the normalizer's `walkDescriptors`/the import walk). For every emitted `EntityRecord`, confirm `toValues(rec, meta)` does NOT throw and always emits `body`, `bodyHash`, `chainId`, `contract`, `selector` (the identity + body are always present even when `functionName`/`eip712PrimaryType` are omitted). Count rows where `functionName` or `eip712PrimaryType` was omitted; assert the total emitted-and-writable row count equals the total emitted row count (0 dropped). Assert the writable count is ≥ 16,364 (the measured full set) so a regression that silently drops rows fails here.

- [ ] **Step 2: Run it**

Run: `npx vitest run test/registry-coverage.test.ts`
Expected: PASS — 0 rows dropped.

- [ ] **Step 3: Build gate + full suite + commit**

Run: `npx tsc --noEmit`, `npm run build`, `npx vitest run` (all green). Then:

```bash
git add test/registry-coverage.test.ts
git commit -m "test: verify 100% of registry records write (0 dropped, was 27.6%)"
```

---

## Notes for the executor

- The identity triple `(chainId, contract, selector)` is unchanged — this feature does not touch dedup/upsert identity. `functionSignature` was never part of the identity.
- `contentHash` (file-level, shared across a file's rows) stays exactly as-is for the sync loop-guard. `bodyHash` (per-row, over `formatBlock`) is new and separate — do not conflate them.
- No config, server-wiring, or new dependency changes. `ServerDeps` is unchanged (`arkiv` already carries the new method).
- Live Arkiv writes are out of scope for implementation. The design's "confirm 100% write" is proven structurally (Task 6), not by a live bulk import.
