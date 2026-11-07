# Klarity TS SDK + EF-Signed EAS Attestation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a typed `@klarity/sdk` (query + decode + two-tier ERC-8176 EAS attest/verify) and wire EF-wallet-signed EAS attestation into the existing signed-write path, surfacing a two-tier `verified` block (EF gate + verified public vouches) on descriptor reads.

**Architecture:** New standalone package under `sdk/` (own package.json/tsconfig, adds `@ethereum-attestation-service/eas-sdk` + `ethers@^6`). Server gains an additive `attestationUID`/`attester` Arkiv column (EF tier), a thin `src/eas/attester.ts`, an auto-attest hook in `POST /descriptors` (write succeeds even if attest fails), and a two-tier `verified` block on the single-descriptor query route. **Tier 1 (EF, the gate):** canonical ERC-8176 schema `bytes32 descriptorHash`, EF wallet attester, stored on the Arkiv row. **Tier 2 (public, the ranking):** extended schema `bytes32 descriptorHash,address contract,uint256 chainId,bytes32 interactionTxHash`, anyone attests, counts only if `interactionTxHash` is a real confirmed tx with `to==contract && from==attester` (RPC-verified); read from EAS, not Arkiv. The attested subject is the unchanged `descriptorHash`; the EAS deployment is chain-configurable (mainnet default, testnet override).

**Tech Stack:** TypeScript (NodeNext ESM — relative imports end `.js`), vitest, viem (existing, server), ethers v6 + eas-sdk (new, SDK + server attester), Fastify.

**Spec:** `docs/superpowers/specs/2026-11-06-klarity-sdk-eas-design.md`

## Global Constraints

- NodeNext ESM: every relative import ends `.js`. No exceptions.
- **No private key is ever read, printed, logged, committed, embedded, or requested.** Signing is always via an injected `signerOrProvider` / signer supplied at runtime by the caller or server config. The key pasted in chat and any `.env` key are compromised and must never be touched.
- No new unrequested live Arkiv or EAS writes during the build. Unit tests only; no live chain writes.
- The attested subject is `descriptorHash(descriptor)` from `src/hash.ts` — unchanged, never recomputed with a different algorithm.
- ERC-8176 EF schema string is exactly `bytes32 descriptorHash`. Schema UID mainnet `0xe023eef113c1670774801c34b377fdf612dd8a4d2fa92fe382e15bd91fafb5c2`, EAS mainnet contract `0xA1207F3BBa224E2c9c3c6D5aF63D0eb1582Ce587`, chainId 1.
- Public (Tier 2) schema string is exactly `bytes32 descriptorHash,address contract,uint256 chainId,bytes32 interactionTxHash` — its own schema UID per EAS deployment, never fabricated (left `''` if unregistered on a chain).
- A public vouch counts ONLY if its `interactionTxHash` verifies: tx exists, is mined, `to == descriptor.contract`, `from == attestation.attester`. An unverifiable/forged tx hash is ignored, never counted.
- Additive schema change only: existing backfilled rows must keep working (read back `verified: false`). No migration.
- An attestation failure must NOT fail or roll back an authorized write.
- Run `npm test` (vitest) for the server; `npm --prefix sdk test` for the SDK. Both green before a task is done.

## Review Focus

- **Attestation failure during a write** — a thrown EAS/RPC error inside `POST /descriptors` must leave the Arkiv upsert + PR intact and report `attested: false`, never a 500 or a lost write. (Task 7 tests.)
- **Over-cap / malformed attestationUID** — a non-`0x`+64hex UID must be rejected before it reaches the `str` column; a stored value is always a valid 66-char hex. (Task 5 tests.)
- **Pre-attestation rows on query** — a row with no `attestationUID` returns `{ efApproved: false, publicVouches: 0, rankedAttesters: [] }`, not a throw or a partial block. (Task 8 tests.)
- **BigInt in attestation metadata** — EAS `time`/`expirationTime`/`revocationTime` are BigInt; any value surfaced in JSON must be coerced (existing `bigintToJson` pattern), never handed raw to Fastify. (Task 8 tests.)
- **EF verify trust filtering** — revoked (`revocationTime != 0`), expired, and untrusted-attester EF attestations must each be excluded; only a trusted, live attestation yields `efApproved: true`. (Task 6 tests.)
- **Forged public interaction proof** — a public attestation whose `interactionTxHash` does not exist, is unmined, has `to != contract`, or `from != attester` must NOT count toward `publicVouches`. A tx from a different wallet, or to a different contract, is the key attack. (Task 6a tests.)

---

## Task 1: Scaffold `@klarity/sdk` package

**Files:**
- Create: `sdk/package.json`, `sdk/tsconfig.json`, `sdk/src/index.ts`, `sdk/vitest.config.ts`
- Create: `sdk/src/hash.ts` (re-export the core hash)
- Test: `sdk/test/smoke.test.ts`

**Interfaces:**
- Produces: `@klarity/sdk` package resolvable; `descriptorHash` re-exported from `sdk/src/hash.ts`.

- [ ] **Step 1: Write `sdk/test/smoke.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { descriptorHash } from '../src/hash.js';

describe('sdk scaffold', () => {
  it('re-exports descriptorHash producing a 0x keccak digest', () => {
    const h = descriptorHash({ b: 2, a: 1 });
    expect(h).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `npm --prefix sdk test` → FAIL (package/files absent).

- [ ] **Step 3: Create the package.**
  - `sdk/package.json`: `name: "@klarity/sdk"`, `"type": "module"`, `"version": "0.1.0"`, scripts `build: "tsc"`, `test: "vitest run"`, devDeps `typescript`, `vitest`, `@types/node`; deps added in Task 4.
  - `sdk/tsconfig.json`: standalone (do NOT inherit root's `rootDir: src`). `module`/`moduleResolution` `NodeNext`, `target` `ES2022`, `strict`, `esModuleInterop`, `skipLibCheck`, `outDir: dist`, `rootDir: src`, `include: ["src"]`.
  - `sdk/vitest.config.ts`: default config (test dir `test`).
  - `sdk/src/hash.ts`: re-export the core hash without copying it (DRY). Use a source-relative re-export: `export { descriptorHash, canonicalHash } from '../../src/hash.js';`, and in `sdk/tsconfig.json` set `rootDir: ".."` with `include: ["src", "../src/hash.ts"]` so the core source compiles into the SDK's `dist` under its own path. If that cross-`rootDir` setup fails to compile, fall back to a workspace export: add `"workspaces": ["sdk"]` + an `"exports"` map (`"./hash": "./dist/hash.js"`) to the root `package.json` and `export … from 'klarity/hash';`. Make the smoke test green either way; record which approach in the commit message.
  - `sdk/src/index.ts`: `export * from './hash.js';` (more added later).

- [ ] **Step 4: Run it, verify it passes** — `npm --prefix sdk test` → PASS.

- [ ] **Step 5: Commit** — `git add sdk/ package.json && git commit -m "feat(sdk): scaffold @klarity/sdk package"`.

---

## Task 2: SDK response/request types

**Files:**
- Create: `sdk/src/types.ts`
- Test: (covered via Task 3 client tests; this task is type-only, no runtime)

**Interfaces:**
- Produces: `Descriptor`, `DescriptorWithFormatBlock`, `DecodeRequest`, `DecodeResponse`, `SigningField`, `VerifiedBlock`, `BrowseFilters` — mirroring `docs/API.md` shapes and the `verified` block added in Task 8.

- [ ] **Step 1: Define the types** in `sdk/src/types.ts` from the response shapes in `docs/API.md` (single descriptor incl. `formatBlock`; `/decode` request union + response `{ signing, fields, hiddenFields, note, raw }`; two-tier `VerifiedBlock = { efApproved: boolean; efAttester?: string; efAttestationUID?: string; publicVouches: number; rankedAttesters: PublicVouch[] }` where `PublicVouch = { attester: string; interactionTxHash: string; attestationUID: string }`). Export all. No logic.

- [ ] **Step 2: Typecheck** — `npm --prefix sdk run build` → no errors.

- [ ] **Step 3: Commit** — `git add sdk/src/types.ts && git commit -m "feat(sdk): response/request types"`.

---

## Task 3: `KlarityClient` HTTP wrapper

**Files:**
- Create: `sdk/src/client.ts`
- Test: `sdk/test/client.test.ts`

**Interfaces:**
- Consumes: types from `sdk/src/types.ts`.
- Produces: `class KlarityClient` with `getDescriptor(chainId, contract, selector)`, `listByContract(chainId, contract)`, `browse(filters)`, `decode(input)`, `getNonce(address)`. Constructor `{ baseUrl: string; fetch?: typeof fetch }`.

- [ ] **Step 1: Write `sdk/test/client.test.ts`** — a mock `fetch` capturing URL/method/body. Assert: `getDescriptor(1,'0xAbc','0x04f04769')` GETs `${base}/descriptors/1/0xabc/0x04f04769` (contract lower-cased) and returns the parsed body typed as `DescriptorWithFormatBlock`; `browse({chainId:1,kind:'calldata'})` builds `?chainId=1&kind=calldata`; `decode({chainId,contract,calldata})` POSTs JSON to `/decode`; a non-2xx response throws an error carrying the status. At least 5 assertions.

- [ ] **Step 2: Run, verify fail** — `npm --prefix sdk test` → FAIL.

- [ ] **Step 3: Implement `KlarityClient`** in `sdk/src/client.ts` — a thin typed wrapper over the injected `fetch`, URL-building per `docs/API.md`, lower-casing `contract`, JSON body for `decode`, throw on non-2xx. Export from `index.ts`.

- [ ] **Step 4: Run, verify pass** — `npm --prefix sdk test` → PASS.

- [ ] **Step 5: Commit** — `git add sdk/ && git commit -m "feat(sdk): KlarityClient HTTP wrapper"`.

---

## Task 4: EAS chain config profiles

**Files:**
- Create: `sdk/src/config.ts`
- Modify: `sdk/package.json` (add deps `@ethereum-attestation-service/eas-sdk@^2.10.0`, `ethers@^6`)
- Test: `sdk/test/config.test.ts`

**Interfaces:**
- Produces: `interface EasProfile { chainId: number; easContract: string; efSchemaUID: string; publicSchemaUID: string; rpcUrl?: string }`; const `MAINNET` (spec values), `SEPOLIA`, `BASE_SEPOLIA`. `const EF_SCHEMA_STRING = 'bytes32 descriptorHash'`; `const PUBLIC_SCHEMA_STRING = 'bytes32 descriptorHash,address contract,uint256 chainId,bytes32 interactionTxHash'`.

- [ ] **Step 1: Write `sdk/test/config.test.ts`** — assert `MAINNET.chainId === 1`, `MAINNET.easContract === '0xA1207F3BBa224E2c9c3c6D5aF63D0eb1582Ce587'`, `MAINNET.efSchemaUID === '0xe023eef113c1670774801c34b377fdf612dd8a4d2fa92fe382e15bd91fafb5c2'`, `EF_SCHEMA_STRING === 'bytes32 descriptorHash'`, `PUBLIC_SCHEMA_STRING` exactly the 4-field string above, and that `SEPOLIA`/`BASE_SEPOLIA` have distinct non-empty EAS contracts.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Install deps + implement `config.ts`.** `npm --prefix sdk install @ethereum-attestation-service/eas-sdk@^2.10.0 ethers@^6`. Fill profiles; testnet EAS contract values from the EAS deployments doc. Schema UIDs not yet registered on a chain → `''` with a comment (never fabricate a UID).

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit** — `git add sdk/ && git commit -m "feat(sdk): EAS chain profiles + EF/public schema strings"`.

---

## Task 5: Add `attestationUID`/`attester` to the Arkiv schema

**Files:**
- Modify: `src/arkiv/schema.ts` (column, `INDEXED_ATTRIBUTES`, `WriteMeta`, `toValues`)
- Modify: `src/arkiv/client.ts` (`BASE_SELECT` + the `upsert` patch path so a UID can be patched in)
- Test: `test/` (schema `toValues` unit test — find the existing schema test file and extend it; else add `test/schema.test.ts`)

**Interfaces:**
- Consumes: existing `WriteMeta`, `toValues`.
- Produces: `WriteMeta` gains `attestationUID?: string; attester?: string`. `toValues` emits an indexed `str` `attestationUID` and `addr` `attester` when present and valid; omits when absent. `BASE_SELECT` includes both so reads surface them.

- [ ] **Step 1: Write the failing test** — `toValues(rec, { ...meta, attestationUID: '0x'+'ab'.repeat(32), attester: '0xEF..' })` includes an `attestationUID` str value and an `attester` addr value; `toValues(rec, meta)` (no attestation) omits both keys. A malformed UID (not `0x`+64hex) is omitted (guard like `fitsStrCap` + a hex check). Assert each.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** — add `attestationUID: str().indexed().optional()` and `attester: addr().indexed().optional()` to `ClearSignDescriptor`; add both to `INDEXED_ATTRIBUTES`; extend `WriteMeta`; in `toValues` emit them when present and the UID matches `/^0x[0-9a-fA-F]{64}$/`; add both to `BASE_SELECT` in `client.ts`.

- [ ] **Step 4: Run, verify pass** — `npm test`.

- [ ] **Step 5: Commit** — `git add src/ test/ && git commit -m "feat(arkiv): additive attestationUID/attester columns"`.

---

## Task 6: SDK `attest.ts` — EF tier (ERC-8176 attest / read / verify)

**Files:**
- Create: `sdk/src/attest.ts`
- Test: `sdk/test/attest.test.ts`

**Interfaces:**
- Consumes: `EasProfile`, `EF_SCHEMA_STRING` from `config.ts`; `descriptorHash` from `hash.ts`; `SchemaEncoder`, `EAS` from eas-sdk.
- Produces: `class KlarityAttester({ profile, signerOrProvider })` with `attestDescriptor(descriptor, opts?)` → UID (EF tier), `getEfAttestation(uid)`, and `verifyEf(descriptor, { trustedAttesters })` → `{ efApproved, efAttester?, efAttestationUID? }`. Pure helpers `encodeEfData(hash)` / `decodeEfData(data)` for chain-free unit tests.

- [ ] **Step 1: Write `sdk/test/attest.test.ts`** (EF tier) — no live chain. Assert: `encodeEfData(h)` → `decodeEfData(...)` round-trips to `h` (SchemaEncoder over `bytes32 descriptorHash`); `verifyEf` over FIXTURE attestations (injected fake reader) — trusted + live ⇒ `efApproved: true`; revoked (`revocationTime != 0n`), expired, untrusted-attester each ⇒ `efApproved: false`. At least 5 assertions.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement the EF tier in `attest.ts`** — `encodeEfData`/`decodeEfData` via `SchemaEncoder`; `attestDescriptor`: `descriptorHash` → encode → `new EAS(profile.easContract).connect(signerOrProvider)` → `eas.attest({ schema: profile.efSchemaUID, data: { recipient: ZERO, expirationTime: 0n, revocable: true, data } })` → UID; `verifyEf`: gather EF-schema attestations for the hash, filter `attester ∈ trustedAttesters && revocationTime === 0n && (expirationTime === 0n || expirationTime > now)`. Export from `index.ts`.

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit** — `git add sdk/ && git commit -m "feat(sdk): EF-tier ERC-8176 attest/read/verify"`.

---

## Task 6a: SDK public tier — interaction-proven vouches

**Files:**
- Modify: `sdk/src/attest.ts` (public-tier methods)
- Test: `sdk/test/public-attest.test.ts`

**Interfaces:**
- Consumes: `PUBLIC_SCHEMA_STRING`, `profile.publicSchemaUID`; an ethers `provider` for tx verification.
- Produces, on `KlarityAttester`: `attestPublic(descriptor, { contract, chainId, interactionTxHash }, signer)` → UID; `verifyInteraction(provider, { contract, attester, interactionTxHash })` → `boolean` (pure RPC check); `verifyPublic(descriptor, { provider })` → `{ publicVouches: number; rankedAttesters: PublicVouch[] }`; and a combined `verifyDescriptor(descriptor, { trustedAttesters, provider })` → full two-tier `VerifiedBlock` (calls `verifyEf` + `verifyPublic`).

- [ ] **Step 1: Write `sdk/test/public-attest.test.ts`** — mock the ethers `provider.getTransaction`/`getTransactionReceipt`. Assert `verifyInteraction` returns: true for a mined tx with `to == contract && from == attester`; **false** for (a) tx not found, (b) `to != contract`, (c) `from != attester` (the forgery — tx from a different wallet), (d) unmined (no receipt / 0 confirmations). Then `verifyPublic` over fixtures: only interaction-verified attestations count toward `publicVouches`; `rankedAttesters` lists distinct verified attesters. `encodePublicData`/`decodePublicData` round-trip the 4-field schema. At least 7 assertions (each forgery case named).

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement the public tier** — `encodePublicData`/`decodePublicData` via `SchemaEncoder` over `PUBLIC_SCHEMA_STRING`; `attestPublic` → `eas.attest({ schema: profile.publicSchemaUID, data })`; `verifyInteraction`: `provider.getTransaction(txHash)` + receipt, check mined, `tx.to?.toLowerCase() === contract.toLowerCase()`, `tx.from.toLowerCase() === attester.toLowerCase()`; `verifyPublic`: gather public-schema attestations for the hash, decode each, keep those whose `interactionTxHash` passes `verifyInteraction` with the attestation's `attester`, dedupe by attester; `verifyDescriptor`: merge both tiers into `VerifiedBlock`.

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit** — `git add sdk/ && git commit -m "feat(sdk): public-tier interaction-proven vouches + two-tier verifyDescriptor"`.

---

## Task 7: Server-side EF attester + auto-attest on write

**Files:**
- Create: `src/eas/attester.ts`
- Modify: `src/routes/write.ts` (auto-attest after the create/update upsert loop)
- Modify: `src/config.ts` (optional EAS signer/profile config — absent ⇒ attestation skipped, never a key read)
- Modify: `src/server.ts` (thread the optional attester into `ServerDeps`)
- Test: `test/server.test.ts` (write-route attestation behavior with an injected fake attester)

**Interfaces:**
- Consumes: `descriptorHash` (already imported in write.ts), the shared EAS logic (import from the SDK package, or a thin local wrapper — reuse, don't duplicate the SchemaEncoder call).
- Produces: `interface EfAttester { attest(descriptorHash: string): Promise<{ uid: string; attester: string }> }`; `ServerDeps.attester?: EfAttester`. On a successful create/update write, when an attester is configured, call it and patch `attestationUID`/`attester` onto the row(s); response gains `attestationUID?` + `attested: boolean`.

- [ ] **Step 1: Write failing tests** in `test/server.test.ts` — inject a FAKE `attester` into `buildServer` deps. (a) A valid create write ⇒ response has `attested: true` + an `attestationUID`, and the upserted row carries the UID. (b) An attester that THROWS ⇒ the write still returns 200 with `entityKey`/`txHash`/`prUrl` and `attested: false` (write not lost). (c) No attester configured ⇒ write succeeds, `attested: false`, no UID. Assert each.

- [ ] **Step 2: Run, verify fail** — `npm test`.

- [ ] **Step 3: Implement.** `src/eas/attester.ts`: a `makeEfAttester({ profile, signer })` producing an `EfAttester` that wraps the SDK's attest logic; signer injected, never read from a key file. `src/config.ts`: optional `eas` block (profile name + an injected signer handle); absent ⇒ no attester. `src/server.ts`: build+thread the optional attester. `src/routes/write.ts`: after the upsert loop, if `deps.attester` present, `try { const { uid, attester } = await deps.attester.attest(contentHash); /* re-upsert/patch row with attestationUID */ attested = true } catch { attested = false }`; include `attestationUID`/`attested` in the reply. The patch reuses `arkiv.upsert` with the attestation fields in `WriteMeta` (idempotent — same identity patches the existing row).

- [ ] **Step 4: Run, verify pass** — `npm test`.

- [ ] **Step 5: Commit** — `git add src/ test/ && git commit -m "feat(write): EF-signed EAS attestation on authorized write"`.

---

## Task 8: `verified` block on the query route

**Files:**
- Modify: `src/routes/query.ts` (single-descriptor route emits `verified`)
- Modify: `docs/API.md` (document the `verified` block)
- Test: `test/server.test.ts` (query route verified cases)

**Interfaces:**
- Consumes: `attestationUID`/`attester` read back via `BASE_SELECT` (Task 5).
- Produces: single-descriptor response gains `verified: VerifiedBlock` (two-tier shape from Task 2). The EF tier comes from the stored row columns; the public tier is best-effort on the HTTP route — `publicVouches: 0, rankedAttesters: []` when no EAS indexer is configured (the SDK's `verifyDescriptor` is the authoritative live public check). No live EAS read on GET for the EF tier; `attestedAt` omitted in v1.

- [ ] **Step 1: Write failing tests** in `test/server.test.ts` — a row WITH `attestationUID`+`attester` ⇒ `verified: { efApproved: true, efAttester, efAttestationUID, publicVouches: 0, rankedAttesters: [] }`; a row WITHOUT ⇒ `verified: { efApproved: false, publicVouches: 0, rankedAttesters: [] }`. Any BigInt in surfaced metadata coerced via `bigintToJson` (no raw BigInt reaches the response). Assert each.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** — in the single-descriptor handler, after unwrapping, read `attestationUID`/`attester` (envelope `.value`); build the two-tier `verified` block (EF tier from the row; public tier defaults to `publicVouches: 0, rankedAttesters: []` absent an indexer); attach to the response object. Document in `docs/API.md`.

- [ ] **Step 4: Run, verify pass** — `npm test`.

- [ ] **Step 5: Commit** — `git add src/ docs/ test/ && git commit -m "feat(query): verified block from EF attestation"`.

---

## Task 9: SDK README + docs

**Files:**
- Create: `sdk/README.md`
- Modify: `docs/API.md` (cross-link the SDK; note the `verified` block source)

**Interfaces:** none (docs only).

- [ ] **Step 1: Write `sdk/README.md`** — install, `KlarityClient` usage (query + decode), `KlarityAttester` usage (attest with an injected signer; `verifyDescriptor` with `trustedAttesters: [EF_WALLET]`), and the "mainnet subject / testnet EAS" note + the "SDK never touches a private key" contract.

- [ ] **Step 2: Commit** — `git add sdk/README.md docs/ && git commit -m "docs(sdk): README + API cross-links"`.

---

## Self-Review notes

- **Spec coverage:** client (T3), decode (T3 via `decode`), EF-tier EAS attest/read/verify (T6), public-tier interaction-proven vouches + two-tier `verifyDescriptor` (T6a), EF-as-attester auto-write (T7), two-tier `verified` block (T8), chain-configurable profiles + both schema strings (T4), schema column (T5), README (T9). All design sections map to a task.
- **Type consistency:** two-tier `VerifiedBlock`/`PublicVouch` defined in T2, produced in T8, returned by `verifyDescriptor` in T6a; `EfAttester` defined in T7; `EasProfile`/`EF_SCHEMA_STRING`/`PUBLIC_SCHEMA_STRING`/`efSchemaUID`/`publicSchemaUID` in T4 consumed in T6/T6a/T7; `attestationUID`/`attester` column (T5) read in T8. `verifyEf` (T6) + `verifyPublic`/`verifyInteraction` (T6a) names are consistent across both tasks.
- **Review Focus:** attestation-failure-preserves-write (T7b), malformed UID (T5), pre-attestation row returns zeroed two-tier block (T8), BigInt coercion (T8), EF verify trust filter (T6), forged public interaction proof — wrong `from`/`to`/unmined/missing tx each ignored (T6a) — each has an owning test.
- **Open mechanical choice:** T1 Step 3 resolves the SDK↔core hash sharing (workspace export vs. source path) at build time, picking whichever compiles cleanly; noted in commit.
- **Two-tier integrity:** no task collapses attestation to EF-only; the public ranking tier (T6a) and its forgery guard are first-class, per the trust-model decision.
