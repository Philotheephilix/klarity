# Klarity TypeScript SDK + ERC-8176 EAS Attestation — Design

**Date:** 2026-11-06
**Status:** Awaiting approval
**Scope (this phase):** TypeScript SDK only. Rust library, descriptor-authoring
tooling, and registry/schema-v2 work are explicitly out of scope.

---

## Intent

Ship a typed TypeScript SDK (`@klarity/sdk`) **and** wire EF-signed EAS
attestation into the existing write path, so that:

1. **Query** the Klarity HTTP API (mirrored ERC-7730 descriptors) with typed
   responses — and see a `verified` block when an EF attestation exists.
2. **Decode** a call a user is about to sign into a human-readable breakdown
   (wraps `POST /decode`).
3. **Attest / read / verify** ERC-8176 descriptor attestations on the Ethereum
   Attestation Service. **The EF allowlisted wallet is the attester:** approving
   an entity via the signed write *is* the attestation. A descriptor shows as
   "verified" when an EAS attestation over its `descriptorHash`, signed by the
   EF wallet, exists — and the response carries that attestation's UID as proof.
   Wallets decide whom to trust; trusting the EF wallet is the default signal.

This is the "developer libraries for wallet integration + attestation
workflows" leg of the ERC-7730 ecosystem vision, TypeScript first.

## Attestation model: two tiers — EF gate + public ranking (resolved)

Attestation is **not** EF-only; that would be centralized. Two independent tiers:

### Tier 1 — EF attestation = the barrier/gate

The attester is the **EF-allowlisted wallet** that authorizes signed writes
through `POST /descriptors`. The approval and the attestation are one act:

- **Auto on signed write.** After a `create`/`update` write's Arkiv upsert
  succeeds, the server creates an EF-signed EAS attestation over the
  `descriptorHash` using the canonical ERC-8176 schema (`bytes32
  descriptorHash`). One EF approval = one write + one attestation.
- **Injected signer, never a stored key.** Signed by an ethers signer the
  server is constructed with at runtime. The SDK/attest module **never** reads,
  embeds, logs, or requests a private key. The compromised key in chat / `.env`
  is never touched.
- This is the authoritative "admitted" signal — EF is the gate.

### Tier 2 — Public attestations = the ranking / reputation layer

**Anyone** can attest to a descriptor, but a public vouch only counts if the
attester proves they actually **used the contract**:

- **Extended EAS schema** (distinct schema UID, same EAS deployment):
  `bytes32 descriptorHash, address contract, uint256 chainId, bytes32 interactionTxHash`.
- **Proof of interaction (verified, not self-claimed).** The
  `interactionTxHash` must be a **real, confirmed** transaction on the given
  `chainId` where `to == contract` and `from == attester`. Verification is an
  RPC `getTransaction`/`getTransactionReceipt` check: the tx exists, is mined,
  its `to` equals the descriptor's contract, its `from` equals the EAS
  attestation's `attester`. A public attestation whose `interactionTxHash`
  fails any of these is **ignored** — it never counts toward the ranking.
- **Ranking.** Verified public vouches accumulate into a count (and the list of
  distinct attester addresses). More demonstrated-use vouchers → higher
  confidence. The EF gate and the public count are reported side by side.

### Surface — EF gate + vouch count

The single-descriptor query route and the SDK `verifyDescriptor` both report:

```jsonc
"verified": {
  "efApproved": true,              // Tier 1: an EF EAS attestation over the hash exists
  "efAttester": "0x…EF",           // present when efApproved
  "efAttestationUID": "0x…",       // present when efApproved
  "publicVouches": 3,              // Tier 2: count of VERIFIED public attestations
  "rankedAttesters": [             // distinct verified public attesters
    { "attester": "0x…", "interactionTxHash": "0x…", "attestationUID": "0x…" }
  ]
}
```

EF is the gate (`efApproved`), public vouches are the ranking.

## Why

A wallet showing clear-signing needs two things the raw registry can't give it
alone: (a) a typed, ergonomic client so integration isn't hand-rolled `fetch`,
and (b) a trust signal — *who reviewed this descriptor and do I trust them?*
ERC-8176 answers (b) via EAS; this SDK makes both one import.

## Key research findings (settled)

- **ERC-8176** (Draft, "Descriptor Attestations for ERC-7730"): the EAS schema
  is a single field — `bytes32 descriptorHash`. Nothing else. Attester, time,
  expiration, revocation, refUID are native EAS fields.
- The attestation **subject is a content hash**: resolve includes → RFC 8785
  (JCS) canonical JSON → keccak-256. Klarity's existing `src/hash.ts`
  `descriptorHash()` computes **exactly** this. The hash is pure content — zero
  chain coupling.
- **EAS SDK**: `@ethereum-attestation-service/eas-sdk` v2.10.0, peer dep
  **ethers v6**. Coexists with the repo's viem (EAS just needs an ethers
  signer/provider; viem stays for everything else).
- Spec **pins mainnet** for the EAS deployment (chainId 1, EAS
  `0xA1207F3BBa224E2c9c3c6D5aF63D0eb1582Ce587`, schema UID
  `0xe023eef113c1670774801c34b377fdf612dd8a4d2fa92fe382e15bd91fafb5c2`).

## The chain decision (resolved: "data is mainnet, EAS is testnet")

The thing being attested and the place the attestation lives are **independent**:

- **Subject (data) = mainnet / spec-conformant.** We hash the real descriptor
  with the unchanged `descriptorHash()`. A descriptor for a mainnet contract
  hashes to the same `bytes32` regardless of where we attest. No "fake" or
  non-conformant subject is ever produced.
- **EAS deployment = testnet, this dev phase.** We write/read attestations
  against a testnet EAS (Sepolia or Base Sepolia) so live attestation flows can
  be exercised without a funded mainnet key.

So `config.ts` carries two independent axes:
- `subject`: always the spec's canonical hash algorithm (fixed, not
  configurable — there is only one correct way to hash).
- `eas`: `{ chainId, easContract, schemaUID, registryContract, rpcUrl }` — a
  chain profile. Ships with a `MAINNET` profile (spec values, the conformant
  target) and a `SEPOLIA` / `BASE_SEPOLIA` profile for dev. The EAS module is
  constructed with whichever profile the caller passes; mainnet is the default
  so the conformant path is the no-config path.

A testnet attestation is understood as a *dev/test* attestation of a real
(mainnet-subject) descriptor hash. When the schema UID differs per chain (EAS
schema UIDs are per-deployment), each profile carries its own UID; the SDK does
not assume the mainnet UID exists on a testnet.

## Package structure

Two surfaces: a new SDK package **and** server-side changes to wire EF
attestation into the write/query path.

### New workspace package

```
sdk/
  package.json          # @klarity/sdk; deps: @ethereum-attestation-service/eas-sdk, ethers@^6
  tsconfig.json         # extends root; NodeNext ESM — relative imports end .js
  src/
    index.ts            # public re-exports
    client.ts           # KlarityClient — typed wrapper over the HTTP API
    types.ts            # response/request types mirroring the API shapes
    hash.ts             # re-export descriptorHash (shared with core, not copied)
    config.ts           # EAS chain profiles: MAINNET (spec) + SEPOLIA/BASE_SEPOLIA
    attest.ts           # EAS / ERC-8176: attest, read, verify
  test/
    client.test.ts      # mock fetch — request shaping + typed responses
    attest.test.ts      # SchemaEncoder encode/decode round-trip + trust-filter logic
```

### Server-side changes (existing `src/`)

- **`src/arkiv/schema.ts`** — add an optional indexed `str` column
  `attestationUID` (holds the `0x…` 32-byte UID; a 66-char hex string, well
  under the 128B str cap). Optionally `attester` (addr, = EF wallet). `toValues`
  gains these via `WriteMeta`; omitted when absent (pre-attestation rows).
- **`src/eas/attester.ts`** (new) — the server-side EF attester: given a
  `descriptorHash` and an injected ethers signer + EAS profile, create the
  attestation and return its UID. This is the server's own thin use of the same
  EAS logic the SDK exposes (shared where practical).
- **`src/routes/write.ts`** — after the `create`/`update` upsert loop succeeds,
  create the EF EAS attestation over `contentHash`, then patch `attestationUID`
  (and `attester`) onto the row(s). The recovered `signer` is already the EF
  wallet address. Attestation failure policy: **the write still succeeds**
  (Arkiv + PR), and the response reports attestation status separately — a
  flaky RPC must not lose an authorized write. Response gains
  `{ …, attestationUID?, attested: boolean }`.
- **`src/routes/query.ts`** — the single-descriptor route reads `attestationUID`
  / `attester` back for the EF tier and emits the `verified` block
  (`efApproved` + the two-tier shape). **Public-tier reads come from EAS, not
  Arkiv** — Arkiv only holds our mirrored descriptors, never arbitrary public
  attestations. The route (when an EAS reader is configured) queries public
  attestations over the `descriptorHash` by the public schema UID and verifies
  each `interactionTxHash` via RPC before counting it. Because enumerating
  attestations by schema+subject needs an EAS indexer/GraphQL, the HTTP route's
  public tier is **best-effort and cached**: if no indexer is configured it
  returns `publicVouches: 0` and defers to the SDK's `verifyDescriptor` for the
  authoritative, live two-tier check. The EF tier never depends on an indexer
  (it's a single known UID stored on the row).

## Module designs

### `client.ts` — KlarityClient

```ts
new KlarityClient({ baseUrl: string; fetch?: typeof fetch })
```

- `getDescriptor(chainId, contract, selector)` → single descriptor incl.
  `formatBlock` (wraps `GET /descriptors/:chainId/:address/:selector`)
- `listByContract(chainId, contract)` → descriptor array
- `browse(filters)` → filtered array (`GET /descriptors?…`)
- `decode(input)` → the "what you're signing" breakdown (wraps `POST /decode`);
  `input` is `{ chainId, contract, calldata }` or
  `{ chainId, contract, typedData, selector? }`
- `getNonce(address)` → nonce suggestion

All responses typed in `types.ts` from the shapes in `docs/API.md`. No secrets,
no signing — this half is read + decode only.

### `attest.ts` — ERC-8176 / EAS

```ts
new KlarityAttester({ profile: EasProfile; signerOrProvider })
```

- `attestDescriptor(descriptor, { offchain?, expirationTime?, revocable? })`
  → compute `descriptorHash(descriptor)`,
  `new SchemaEncoder('bytes32 descriptorHash').encodeData([{ name, value, type }])`,
  then `eas.attest({ schema: profile.schemaUID, data })` (onchain) or
  `signOffchainAttestation(...)` (offchain). Returns the attestation UID (or the
  offchain signed blob).
- `getAttestationsFor(descriptorHash)` → onchain read by UID
  (`eas.getAttestation`); offchain verified via
  `verifyOffchainAttestationSignature`. (Enumerating all attestations for a hash
  needs an indexer/GraphQL for the full set; v1 reads a known UID or a
  caller-supplied set — noted as a limitation, not a blocker.)
- `verifyDescriptor(descriptor, { trustedAttesters?, provider })` → hash it,
  gather both tiers, return `{ efApproved, efAttester?, efAttestationUID?,
  publicVouches, rankedAttesters }`. **EF tier:** an EF-schema attestation over
  the hash whose attester is the EF wallet (or any `trustedAttesters` the caller
  passes), not revoked, not expired. **Public tier:** public-schema attestations
  over the hash, each kept only if its `interactionTxHash` verifies against
  `provider` (`to == contract`, `from == attester`, tx mined). This is the
  two-tier "EF gate + public ranking" core.
- `attestPublic(descriptor, { contract, chainId, interactionTxHash }, signer)` →
  the public-tier attest call (extended schema). The caller supplies a signer
  for their OWN wallet; the SDK verifies the tx is theirs before/at attest time
  is a caller concern, but `verifyDescriptor` re-verifies on read regardless.
- `verifyInteraction(provider, { contract, attester, interactionTxHash, chainId })`
  → the pure RPC check (tx exists, mined, `to`/`from` match). Exported for
  unit-testing against a mocked provider.

### `config.ts`

Two schema strings and two UIDs per profile:
- `EF_SCHEMA_STRING = 'bytes32 descriptorHash'` (canonical ERC-8176, Tier 1).
- `PUBLIC_SCHEMA_STRING = 'bytes32 descriptorHash,address contract,uint256 chainId,bytes32 interactionTxHash'` (Tier 2).

`MAINNET` = spec values (chainId 1, EAS contract + EF schema UID above; public
schema UID registered separately). `SEPOLIA` / `BASE_SEPOLIA` = dev profiles
(EAS testnet contract + that chain's EF & public schema UIDs). Each profile
carries both UIDs and an `rpcUrl` slot. A UID not yet registered on a chain is
left `''` with a comment — `attest` registers-or-requires it, never fabricated.

## Testing

- **Unit only, no live chain writes.** `client.test.ts` mocks `fetch` and
  asserts URL/method/body shaping and that responses deserialize to the typed
  shapes. `attest.test.ts` asserts the `SchemaEncoder` round-trip (hash →
  encoded data → decoded back == hash) and the `verifyDescriptor` trust-filter
  logic against fixture attestations (revoked / expired / untrusted-attester /
  trusted — each asserted).
- A **live testnet attestation** requires a funded testnet signer supplied at
  runtime. The SDK accepts a `signerOrProvider` the caller constructs; the SDK
  **never** reads, embeds, or requests a private key. No live write happens in
  this build without an explicit, separately-authorized go-ahead and a funding
  source — and never using any key pasted in chat or living in `.env`.

## Non-goals / anti-goals

- No Rust library this phase.
- No descriptor-authoring UI/tooling this phase.
- No registry or schema-v2 changes.
- The SDK never handles, stores, or logs a private key. Signing is the caller's
  `signerOrProvider`.
- No attestation is auto-treated as "truth" — `verifyDescriptor` only ever
  reports against a caller-supplied trust set.

## Security constraints (carried, in force)

- `.env` and any private key are never read, printed, committed, or used.
- The private key and GitHub PAT previously pasted in chat are compromised and
  must never be touched.
- No unrequested live Arkiv writes. (The authorized backfill continues
  independently.)

## Build order (feeds the plan)

1. Workspace + `@klarity/sdk` scaffold (package.json, tsconfig, index).
2. `types.ts` + `client.ts` + `client.test.ts` (read/decode half — no new deps).
3. `config.ts` (EAS profiles) + shared EAS attest/read/verify logic.
4. `attest.ts` + `attest.test.ts` (adds eas-sdk + ethers v6).
5. **Server wiring:** `src/arkiv/schema.ts` `attestationUID`/`attester` column +
   `toValues`/`WriteMeta`; `src/eas/attester.ts`; `src/routes/write.ts`
   auto-attest-after-upsert (write-succeeds-even-if-attest-fails); patch UID
   onto the row.
6. **Query surface:** `src/routes/query.ts` `verified` block; update
   `docs/API.md`.
7. SDK README with usage + the "mainnet subject / testnet EAS" note.

## Open questions (flag at review, not blockers)

- **`attestedAt` / live verification in the query route.** Emitting `attestedAt`
  (and confirming the attestation isn't revoked) requires an EAS *read* on every
  descriptor GET — an RPC round-trip per request. Options: (a) store
  `attestedAt` at write time and report the UID without a live revocation check
  (fast, can go stale if revoked); (b) do a live EAS read on GET (authoritative,
  slower). Lean (a) for v1, with `verifyDescriptor` in the SDK as the
  authoritative live check. Decide at review.
- **Schema change on live data.** Adding `attestationUID` is additive (optional
  column); existing backfilled rows simply have `verified: false`. No migration
  needed. Confirm that's acceptable.
