# Klarity TS SDK + EF-Signed EAS Attestation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a typed `@klarity/sdk` (query + decode + ERC-8176 EAS attest/verify) and wire EF-wallet-signed EAS attestation into the existing signed-write path, surfacing a `verified` block on descriptor reads.

**Architecture:** New standalone package under `sdk/` (own package.json/tsconfig, adds `@ethereum-attestation-service/eas-sdk` + `ethers@^6`). Server gains an additive `attestationUID`/`attester` Arkiv column, a thin `src/eas/attester.ts`, an auto-attest hook in `POST /descriptors` (write succeeds even if attest fails), and a `verified` block on the single-descriptor query route. The attested subject is the unchanged `descriptorHash` (spec-conformant, mainnet semantics); the EAS deployment is chain-configurable (mainnet default, testnet override).

**Tech Stack:** TypeScript (NodeNext ESM — relative imports end `.js`), vitest, viem (existing, server), ethers v6 + eas-sdk (new, SDK + server attester), Fastify.

**Spec:** `docs/superpowers/specs/2026-11-06-klarity-sdk-eas-design.md`

## Global Constraints

- NodeNext ESM: every relative import ends `.js`. No exceptions.
- **No private key is ever read, printed, logged, committed, embedded, or requested.** Signing is always via an injected `signerOrProvider` / signer supplied at runtime by the caller or server config. The key pasted in chat and any `.env` key are compromised and must never be touched.
- No new unrequested live Arkiv or EAS writes during the build. Unit tests only; no live chain writes.
- The attested subject is `descriptorHash(descriptor)` from `src/hash.ts` — unchanged, never recomputed with a different algorithm.
- ERC-8176 EAS schema string is exactly `bytes32 descriptorHash`. Schema UID mainnet `0xe023eef113c1670774801c34b377fdf612dd8a4d2fa92fe382e15bd91fafb5c2`, EAS mainnet contract `0xA1207F3BBa224E2c9c3c6D5aF63D0eb1582Ce587`, chainId 1.
- Additive schema change only: existing backfilled rows must keep working (read back `verified: false`). No migration.
- An attestation failure must NOT fail or roll back an authorized write.
- Run `npm test` (vitest) for the server; `npm --prefix sdk test` for the SDK. Both green before a task is done.

## Review Focus

- **Attestation failure during a write** — a thrown EAS/RPC error inside `POST /descriptors` must leave the Arkiv upsert + PR intact and report `attested: false`, never a 500 or a lost write. (Task 7 tests.)
- **Over-cap / malformed attestationUID** — a non-`0x`+64hex UID must be rejected before it reaches the `str` column; a stored value is always a valid 66-char hex. (Task 5 tests.)
- **Pre-attestation rows on query** — a row with no `attestationUID` returns `{ verified: false }`, not a throw or a partial block. (Task 8 tests.)
- **BigInt in attestation metadata** — EAS `time`/`expirationTime`/`revocationTime` are BigInt; any value surfaced in JSON must be coerced (existing `bigintToJson` pattern), never handed raw to Fastify. (Task 8 tests.)
- **verifyDescriptor trust filtering** — revoked (`revocationTime != 0`), expired, and untrusted-attester attestations must each be excluded; only a trusted, live attestation yields `verified: true`. (Task 6 tests.)

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

- [ ] **Step 1: Define the types** in `sdk/src/types.ts` from the response shapes in `docs/API.md` (single descriptor incl. `formatBlock`; `/decode` request union + response `{ signing, fields, hiddenFields, note, raw }`; `VerifiedBlock = { verified: false } | { verified: true; attester: string; attestationUID: string; attestedAt?: number }`). Export all. No logic.

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
- Produces: `interface EasProfile { chainId: number; easContract: string; schemaUID: string; registryContract?: string }`; const `MAINNET` (spec values), `SEPOLIA`, `BASE_SEPOLIA` (dev values, each with that deployment's own EAS + schema UID). `const SCHEMA_STRING = 'bytes32 descriptorHash'`.

- [ ] **Step 1: Write `sdk/test/config.test.ts`** — assert `MAINNET.chainId === 1`, `MAINNET.easContract === '0xA1207F3BBa224E2c9c3c6D5aF63D0eb1582Ce587'`, `MAINNET.schemaUID === '0xe023eef113c1670774801c34b377fdf612dd8a4d2fa92fe382e15bd91fafb5c2'`, `SCHEMA_STRING === 'bytes32 descriptorHash'`, and that `SEPOLIA`/`BASE_SEPOLIA` have distinct non-empty EAS contracts.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Install deps + implement `config.ts`.** `npm --prefix sdk install @ethereum-attestation-service/eas-sdk@^2.10.0 ethers@^6`. Fill profiles; testnet EAS contract + schema UID values looked up from the EAS deployments doc (if a testnet schema UID is not yet registered, leave it `''` with a comment that `attest` will register-or-require it — do NOT fabricate a UID).

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit** — `git add sdk/ && git commit -m "feat(sdk): EAS chain profiles + schema string"`.

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

## Task 6: SDK `attest.ts` — ERC-8176 attest / read / verify

**Files:**
- Create: `sdk/src/attest.ts`
- Test: `sdk/test/attest.test.ts`

**Interfaces:**
- Consumes: `EasProfile`, `SCHEMA_STRING` from `config.ts`; `descriptorHash` from `hash.ts`; `SchemaEncoder` from eas-sdk.
- Produces: `class KlarityAttester({ profile, signerOrProvider })` with `attestDescriptor(descriptor, opts?)` → UID (or offchain blob), `getAttestationsFor(descriptorHash, uids?)`, `verifyDescriptor(descriptor, { trustedAttesters })` → `{ verified, attestations }`. Also pure helpers `encodeDescriptorHash(hash)` / `decodeAttestationData(data)` for unit testing without a chain.

- [ ] **Step 1: Write `sdk/test/attest.test.ts`** — no live chain. Assert: `encodeDescriptorHash(h)` then `decodeAttestationData(...)` round-trips to `h` (SchemaEncoder over `bytes32 descriptorHash`); `verifyDescriptor` trust-filter over FIXTURE attestations — a trusted + live attestation ⇒ `verified: true`; a revoked (`revocationTime != 0n`), an expired, and an untrusted-attester attestation each ⇒ excluded / `verified: false`. Mock/stub the chain-reading part (inject a fake `getAttestationsFor`). At least 5 assertions.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `attest.ts`** — `encodeDescriptorHash`/`decodeAttestationData` via `SchemaEncoder`. `attestDescriptor`: compute `descriptorHash`, encode, `new EAS(profile.easContract).connect(signerOrProvider)`, `eas.attest({ schema: profile.schemaUID, data: { recipient: ZERO, expirationTime, revocable, data } })` → UID; offchain branch via `signOffchainAttestation`. `getAttestationsFor`: read a supplied UID set via `eas.getAttestation`. `verifyDescriptor`: hash → gather → filter `attester ∈ trustedAttesters && revocationTime === 0n && (expirationTime === 0n || expirationTime > now)`. Export from `index.ts`.

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit** — `git add sdk/ && git commit -m "feat(sdk): ERC-8176 EAS attest/read/verify"`.

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
- Produces: single-descriptor response gains `verified: VerifiedBlock`. `attestedAt` is omitted in v1 (store-at-write decision: no live EAS read on GET; SDK `verifyDescriptor` is the authoritative live check — noted inline).

- [ ] **Step 1: Write failing tests** in `test/server.test.ts` — a row WITH `attestationUID`+`attester` ⇒ `verified: { verified: true, attester, attestationUID }`; a row WITHOUT ⇒ `verified: { verified: false }`. Any BigInt in surfaced metadata coerced via `bigintToJson` (no raw BigInt reaches the response). Assert each.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** — in the single-descriptor handler, after unwrapping, read `attestationUID`/`attester` (envelope `.value`); build the `verified` block; attach to the response object. Document in `docs/API.md`.

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

- **Spec coverage:** client (T3), decode (T3 via `decode`), EAS attest/read/verify (T6), EF-as-attester auto-write (T7), `verified` block (T8), chain-configurable profiles (T4), schema column (T5), README (T9). All design sections map to a task.
- **Type consistency:** `VerifiedBlock` defined in T2, produced in T8, consumed by SDK types; `EfAttester` defined in T7; `EasProfile`/`SCHEMA_STRING` in T4 consumed in T6/T7; `attestationUID`/`attester` column (T5) read in T8.
- **Review Focus:** attestation-failure-preserves-write (T7b), malformed UID (T5), pre-attestation row (T8), BigInt coercion (T8), verify trust filter (T6) — each has an owning test.
- **Open mechanical choice:** T1 Step 3 resolves the SDK↔core hash sharing (workspace export vs. source path) at build time, picking whichever compiles cleanly; noted in commit.
