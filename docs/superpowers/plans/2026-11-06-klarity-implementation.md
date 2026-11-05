# Klarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A TypeScript backend that mirrors Ledger's ERC-7730 clear-signing registry into Arkiv as queryable entities, with gated two-way GitHub sync.

**Architecture:** One Fastify service. A normalizer turns each ERC-7730 descriptor (include- and `$ref`-resolved) into one Arkiv entity per `(chainId, contract, selector|primaryType)`. An ingest loop pulls Ledger merges into Arkiv; a signed REST endpoint (EIP-712 + allowlist) writes authoritative entities and opens upstream PRs via fork-flow. A keccak256 content-hash breaks the sync loop. Sync state in SQLite.

**Tech Stack:** Node 22+, TypeScript, Fastify, `@arkiv-network/sdk` (1.0.1) + `viem`, `@octokit/rest` (+ throttling/retry plugins), `canonicalize` (RFC 8785), `js-sha3`/viem `keccak256`, `better-sqlite3`, `vitest`.

**Spec:** `plan.md` (design) + `arkiv/schema.md` (entity schema) + `docs/research/05-phase2-validation.md` (validated edge cases). Research: `docs/research/0{1..4}-*.md`.

## Global Constraints

- Node **22.10+** (Arkiv SDK requirement).
- Arkiv SDK **`@arkiv-network/sdk@^1.0.1`**; chain helper **`rabdi`** from `@arkiv-network/sdk/chains`; Rabdi chain id **`7794095`**.
- Schema namespace string: **`clear-signing-erc7730`** (exact, globally shared).
- One hash algorithm everywhere: **keccak256 over RFC 8785 canonical JSON**. The EIP-712 `descriptorHash`, the stored `contentHash`, and the loop guard are the same value.
- All reads filter **`.createdBy(REGISTRY_WALLET)`**; all `contract` values **lowercased**.
- Emit-source exclusions: skip `tests/`, `testsv2/`, `sigs/`, `*.tests.json`, and `common-*.json` as emit-sources (load `common-*`/`ercs/*` only when referenced by `includes`).
- Upstream repo: **`ethereum/clear-signing-erc7730-registry`**, default branch **`master`**, descriptors under `registry/**/*.json`.
- EIP-712 domain: `{ name: "Klarity ClearSign Registry", version: "1", chainId: 7794095 }`.
- Env config only (no secrets in code): `ARKIV_ACCESS_KEY`, `ARKIV_PRIVATE_KEY`, `GITHUB_TOKEN`, `GITHUB_BOT_LOGIN`, `AUTHORIZED_WALLETS`, `GITHUB_WEBHOOK_SECRET`, `UPSTREAM_OWNER`/`UPSTREAM_REPO`, `POLL_INTERVAL_MS`, `DB_PATH`, `PORT`.

## Review Focus

- **Selector derivation on nested/array/tuple params** (e.g. `(address,uint256)[]`, `bytes32[]`) — param-name stripping must keep the canonical type; a wrong selector silently mislabels a call. → Task 2 tests tuple/array/no-arg sigs.
- **`$ref` where field and definition both set the same key** — field's own key must win; getting it backwards changes the displayed label/format. → Task 2 test.
- **Replayed or expired signature / wrong nonce** — a captured valid signature must not write twice, and a past `deadline` must reject. → Task 6 tests.
- **Sync-loop round-trip** — a descriptor we PR'd, once merged upstream, must be a no-op on ingest (byte-identical hash). → Task 7 test.
- **Impostor entity under the shared namespace** — an entity written by a non-registry wallet must never appear in query results. → Task 8 test (query builder always pins `createdBy`).

---

## Task 1: Project scaffold + config

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`, `src/config.ts`
- Test: `test/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(env = process.env): Config` — returns a frozen object with all Global-Constraints env values typed (addresses lowercased, `AUTHORIZED_WALLETS` → `Set<string>`, numbers parsed); throws `ConfigError` listing every missing required var.

- [ ] **Step 1:** Write `test/config.test.ts`: (a) a full valid env yields a `Config` with `authorizedWallets` a lowercased `Set`, `arkiv.chainId === 7794095`; (b) missing `ARKIV_PRIVATE_KEY` + `GITHUB_TOKEN` throws `ConfigError` whose message names both.
- [ ] **Step 2:** Run `npx vitest run test/config.test.ts` — expect FAIL (module missing).
- [ ] **Step 3:** Init `package.json` (type: module, scripts: `dev`,`start`,`build`,`test`,`import`), `tsconfig.json` (NodeNext, strict, target ES2022), install deps from Tech Stack. Implement `loadConfig` + `Config` type + `ConfigError` in `src/config.ts`. Write `.env.example` with every var and a comment each.
- [ ] **Step 4:** Run the test — expect PASS.
- [ ] **Step 5:** Commit `chore: project scaffold and typed config`.

## Task 2: Normalizer (descriptor → entity records)

The heart. Pure functions, no I/O — fully unit-testable against fixtures copied from `vendor/`.

**Files:**
- Create: `src/normalize/selector.ts`, `src/normalize/includes.ts`, `src/normalize/refs.ts`, `src/normalize/normalize.ts`, `src/normalize/types.ts`
- Test: `test/normalize/*.test.ts`
- Fixtures: `test/fixtures/` (copy ~6 real files: Aave calldata multi-deploy, DAI permit via includes, an OKX file with `$ref`+definitions, a Safe eip712 multi-deploy, a 2-level include, a no-arg function)

**Interfaces:**
- Produces:
  - `canonicalSignature(sig: string): string` — strips param names, preserves tuples/arrays. `"depositETH(address pool, uint16 x)"` → `"depositETH(address,uint16)"`.
  - `selectorOf(sig: string): \`0x${string}\`` — `"0x"+keccak256(canonicalSignature(sig))[0:8]`.
  - `resolveIncludes(doc, loadFragment: (relPath, fromPath) => object, fromPath): object` — recursive deep-merge (self wins over fragment), depth cap 10.
  - `inlineRefs(doc: object): object` — replaces each field `{$ref:"$.display.definitions.X", ...}` with `{...definition, ...fieldWithoutRef}` (field keys win); leaves non-`$ref` fields untouched.
  - `normalizeDescriptor(doc, sourcePath): EntityRecord[]` — resolves includes+refs, flattens per deployment × per format key; one `EntityRecord` each.
  - `EntityRecord` (in `types.ts`): `{ chainId:number; contract:string(lowercased); selector:string; functionName:string; functionSignature:string; kind:"calldata"|"eip712"; intent:string; entityName:string; contractName:string; owner:string; sourcePath:string; eip712PrimaryType?:string; schemaVersion:string; formatBlock:object }`. (No `authorizedBy`/`source`/`contentHash` here — added by the writer layer.)

- [ ] **Step 1:** Write `test/normalize/selector.test.ts`: `transfer(address,uint256)`→`0xa9059cbb`; `depositETH(address pool, address onBehalfOf, uint16 referralCode)`→canonical `depositETH(address,address,uint16)`; a tuple-array sig `foo((address,uint256)[] x)`→`foo((address,uint256)[])`; a no-arg `bar()`→`bar()`.
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Implement `selector.ts` (keccak via viem `keccak256(toHex(...))` or `js-sha3`; parse params respecting `()`/`[]` nesting depth).
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Write `test/normalize/refs.test.ts`: a field with `$ref` into `display.definitions` gets the definition's `format`/`label` inlined, but a key present on BOTH (e.g. `visible`) keeps the field's value.
- [ ] **Step 6:** Run — FAIL. Implement `inlineRefs` in `refs.ts`. Run — PASS.
- [ ] **Step 7:** Write `test/normalize/includes.test.ts`: the DAI-permit fixture (no own formats) resolves to a doc WITH formats from the permit fragment; a 2-level include resolves fully; self keys override fragment keys.
- [ ] **Step 8:** Run — FAIL. Implement `resolveIncludes` in `includes.ts`. Run — PASS.
- [ ] **Step 9:** Write `test/normalize/normalize.test.ts`: Aave multi-deploy fixture → N records = (#deployments × #formats), each with lowercased `contract`, correct `selector`, `kind:"calldata"`, `formatBlock` self-contained (no `$ref` string anywhere in JSON). Safe eip712 fixture → records with `kind:"eip712"`, `eip712PrimaryType` set, `functionName`===primaryType.
- [ ] **Step 10:** Run — FAIL. Implement `normalizeDescriptor` in `normalize.ts` composing the above. Run — PASS.
- [ ] **Step 11:** Commit `feat: ERC-7730 normalizer with include and $ref resolution`.

## Task 3: Canonical hashing

**Files:** Create `src/hash.ts`; Test `test/hash.test.ts`

**Interfaces:**
- Produces: `descriptorHash(doc: object): \`0x${string}\`` — `keccak256` over `canonicalize(doc)` (RFC 8785); 32-byte hex. Used identically by writer, loop-guard, and EIP-712 signing.

- [ ] **Step 1:** Test: two objects with keys in different order hash **equal**; a changed value hashes **different**; output is `0x`+64 hex.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement with `canonicalize` + `keccak256(toHex(...))`.
- [ ] **Step 4:** Run — PASS. **Step 5:** Commit `feat: RFC 8785 canonical keccak256 descriptor hash`.

## Task 4: Arkiv client + schema + upsert

**Files:** Create `src/arkiv/schema.ts`, `src/arkiv/client.ts`; Test `test/arkiv/schema.test.ts` (unit), `test/arkiv/client.int.test.ts` (integration, gated on `ARKIV_PRIVATE_KEY`).

**Interfaces:**
- Consumes: `EntityRecord` (Task 2), `descriptorHash` (Task 3), `Config` (Task 1).
- Produces:
  - `ClearSignDescriptor` schema (`defineSchema("clear-signing-erc7730", {...})`) with indexed attributes exactly per `arkiv/schema.md` (chainId u64, contract addr, selector bytes, functionName/functionSignature/kind/intent/entityName/contractName/owner/sourcePath/authorizedBy/source/eip712PrimaryType str/addr, contentHash bytes, schemaVersion str non-indexed).
  - `class ArkivClient` with: `keyFor(rec): string` (NO_SALT + `predictEntityKey` from `(chainId,contract,selector)`), `upsert(rec, {source, authorizedBy?, contentHash}): Promise<{entityKey,txHash}>` (predict key → exists? `patchEntity` : `createEntity` with `ExpirationTime.fromDays(365)`, `flags:{permissionlessExtension:true}`), `remove(key)`, `queryOne({chainId,contract,selector})`, `queryMany(filter)` — all reads pinned `.createdBy(REGISTRY_WALLET)`.

- [ ] **Step 1:** Unit test `schema.test.ts`: schema has the exact indexed attribute set; building a value row from an `EntityRecord` wraps `addr`/`u64`/`bytes` correctly (no bare numbers).
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement `schema.ts` + the value-mapping helper. Run — PASS.
- [ ] **Step 4:** Write `client.int.test.ts` (skips if no `ARKIV_PRIVATE_KEY`): upsert a record → `queryOne` returns it with matching payload; second upsert of same identity patches (same key, no duplicate); `remove` makes `queryOne` return null.
- [ ] **Step 5:** Run — FAIL (or skip). **Step 6:** Implement `ArkivClient`. Run against Rabdi — PASS.
- [ ] **Step 7:** Commit `feat: Arkiv client, schema, deterministic upsert`.

## Task 5: SQLite sync state

**Files:** Create `src/db.ts`, `src/db/schema.sql`; Test `test/db.test.ts`

**Interfaces:**
- Produces: `openDb(path): Db` with `getSyncCursor()/setSyncCursor(sha)`, `isNonceUsed(signer,nonce)/markNonceUsed(signer,nonce)` (unique constraint on `(signer,nonce)`), `getHash(sourcePath)/setHash(sourcePath,hash)`, `wasDelivery(id)/markDelivery(id)`.

- [ ] **Step 1:** Test (in-memory `:memory:`): cursor round-trips; `markNonceUsed` twice on same pair throws/返回 false the second time; `getHash` returns stored value.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement with `better-sqlite3`, DDL in `schema.sql`. Run — PASS. **Step 4:** Commit `feat: sqlite sync-state store`.

## Task 6: EIP-712 verification

**Files:** Create `src/auth.ts`; Test `test/auth.test.ts`

**Interfaces:**
- Consumes: `Config.authorizedWallets`, `descriptorHash` (Task 3), `Db` nonce methods (Task 5).
- Produces: `DescriptorWrite` typed-data types + domain; `verifyWrite({descriptor, message, signature}, db, config): Promise<{signer:string, action:"create"|"update"|"delete"}>` — recompute `descriptorHash(descriptor)===message.descriptorHash`, `now<=deadline`, recover signer via viem `recoverTypedDataAddress`, lowercased allowlist membership, `(signer,nonce)` unused then `markNonceUsed` atomically; throws `AuthError` with a distinct code per failure.

- [ ] **Step 1:** Test: a signature produced by an allowlisted test key (viem `privateKeyToAccount` + `signTypedData`) verifies and returns the signer+action; tampering one descriptor byte → hash-mismatch `AuthError`; `deadline` in the past → expired `AuthError`; signer not in allowlist → unauthorized; reusing a consumed nonce → replay `AuthError`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement `auth.ts`. Run — PASS. **Step 4:** Commit `feat: EIP-712 signed-write verification with replay guard`.

## Task 7: GitHub client (ingest diff + egress PR)

**Files:** Create `src/github.ts`; Test `test/github.test.ts` (nock/undici-mock the REST API — no live calls).

**Interfaces:**
- Consumes: `Config` (upstream, token, bot login).
- Produces: `class GitHubClient` with:
  - `changedDescriptors(sinceSha): Promise<{path,status,sha}[]>` via `compareCommitsWithBasehead(\`${sinceSha}...master\`)`, filtered to `registry/**/*.json`, excluding `tests|testsv2|sigs` and `common-*`.
  - `getFile(path, ref): Promise<{content:object, sha:string}>`.
  - `openDescriptorPR({path, descriptor, entityKey, wallet, action}): Promise<string>` — fork-flow: ensure fork → branch off upstream HEAD → `createOrUpdateFileContents` (base64, with existing blob sha for update; for `delete` → `deleteFile`) → cross-repo `pulls.create(head:"<bot>:<branch>")`; commit message carries `Arkiv-Origin: true` + `Arkiv-Entity: <key>`. Returns PR URL.
  - `headSha(): Promise<string>`.
- Octokit built with throttling + retry plugins.

- [ ] **Step 1:** Test with mocked REST: `changedDescriptors` returns only `registry/**/*.json` and drops a `sigs/` and a `common-*` path; `openDescriptorPR` issues the fork→ref→contents→pulls sequence and returns the mocked PR URL; commit body contains the `Arkiv-Origin` marker.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement `github.ts`. Run — PASS. **Step 4:** Commit `feat: github ingest-diff and fork-flow PR client`.

## Task 8: Sync service (ingest loop + loop guard)

**Files:** Create `src/sync.ts`; Test `test/sync.test.ts`

**Interfaces:**
- Consumes: `GitHubClient`, `ArkivClient`, `Db`, `normalizeDescriptor`, `descriptorHash`.
- Produces: `applyChangedFile({path,status}, deps): Promise<"written"|"skipped"|"deleted">` — fetch file, `descriptorHash`; if `status==="removed"` → remove entities; else if `hash===db.getHash(path)` → **skipped** (loop guard); else normalize → upsert each record (`source:"github-sync"`, `contentHash`) → `setHash`. `runIngestOnce(deps)` — from cursor to head, apply each, advance cursor. `startIngestLoop(deps, intervalMs)`.

- [ ] **Step 1:** Test: feed a changed file twice with identical content → first `"written"`, second `"skipped"` (loop guard via stored hash); a `removed` status → `"deleted"` calls `ArkivClient.remove`; an impostor-wallet entity is excluded because `ArkivClient.queryMany` pins `createdBy` (assert the query carries the filter).
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement `sync.ts`. Run — PASS. **Step 4:** Commit `feat: ingest loop with content-hash loop guard`.

## Task 9: HTTP API (query + signed write + webhook)

**Files:** Create `src/server.ts`, `src/routes/query.ts`, `src/routes/write.ts`, `src/routes/webhook.ts`; Test `test/server.test.ts`

**Interfaces:**
- Consumes: all prior.
- Produces: Fastify app via `buildServer(deps)` with:
  - `GET /descriptors/:chainId/:address/:selector` → one format or 404.
  - `GET /descriptors/:chainId/:address` → all formats for a contract.
  - `GET /descriptors?entityName=&intent=&functionName=&kind=` → filtered list.
  - `GET /nonce/:address` → next nonce.
  - `POST /descriptors` `{descriptor, message, signature}` → `verifyWrite` → on create/update: upsert (`source:"authorized-write"`, `authorizedBy:signer`) + `openDescriptorPR` → `{entityKey, txHash, prUrl}`; on delete: remove + removal PR. `AuthError`→401/400 by code.
  - `POST /webhooks/github` → verify `X-Hub-Signature-256` (raw body, timing-safe), dedupe `X-GitHub-Delivery`, enqueue same `applyChangedFile` path as polling.

- [ ] **Step 1:** Test with `app.inject`: a lookup route returns a seeded descriptor; `POST /descriptors` with a valid allowlisted signature returns `{entityKey,prUrl}` (Arkiv+GitHub deps mocked) and a bad signature returns 401; webhook with a wrong signature → 401, correct → 202; a replayed delivery id → 200 no-op.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement routes + `buildServer` (raw-body plugin for webhook). Run — PASS. **Step 4:** Commit `feat: query, signed-write, and webhook HTTP API`.

## Task 10: Backfill importer + deploy wrapper

**Files:** Create `src/import.ts` (CLI), `Dockerfile`, `README.md`; Test `test/import.test.ts`

**Interfaces:**
- Consumes: `GitHubClient.headSha`, a repo walk (reuse exclusions), `normalizeDescriptor`, `ArkivClient.upsert`, `Db`.
- Produces: `runImport({root}|{fromGitHub}, deps)` — walk/fetch all emit-source descriptors, normalize, upsert with `source:"github-sync"` + contentHash, set each hash, set cursor to head. Batched with concurrency limit + backoff (≈16.4k entities). `npm run import` entry.

- [ ] **Step 1:** Test: point `runImport` at `test/fixtures/` → upserts the expected record count (sum over fixtures) and writes a hash per source path; a re-run is all `skipped`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement `import.ts` (reuse the walk+exclusion logic; share it with `sync` if clean). Write `Dockerfile` (node:22-slim, build, `CMD npm start`) and `README.md` (wallet addresses that wrote entities, one runnable SDK + JSON-RPC query, `npm run import` instructions, CC0 link, AI-usage disclosure). Run — PASS. **Step 4:** Commit `feat: backfill importer, Dockerfile, README`.

---

## Notes for the executor
- `vendor/clear-signing-erc7730-registry` is already cloned; copy fixtures from there, don't depend on the clone at runtime.
- Integration tests touching Rabdi (Task 4 step 4) are gated on `ARKIV_PRIVATE_KEY`; skip cleanly when unset so the suite is green without secrets.
- The normalizer walk + exclusion logic already exists in prototype form in `scripts/analyze.mjs` — port it, don't reinvent.
