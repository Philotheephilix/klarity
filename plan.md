# Klarity — Clear-Signing Registry mirrored to Arkiv

> A TypeScript backend service that mirrors Ledger's ERC-7730 clear-signing
> registry into Arkiv as queryable entities, and keeps the two in sync both
> ways — gated so only Ethereum-Foundation-authorized wallets can push changes
> back to Ledger.

Source registry: <https://github.com/ethereum/clear-signing-erc7730-registry>
(maintained by Ledger, licensed **CC0 1.0** — republishing is explicitly allowed).
Target network: **Arkiv Rabdi testnet** (chain id `7794095`, `@arkiv-network/sdk`).

---

## 1. Intent & the why

Wallets need human-readable ("clear signing") descriptions of what a transaction
does before a user signs. Ledger's ERC-7730 registry holds that data as JSON
descriptor files in GitHub — great for Ledger, awkward for everyone else: to use
it you clone a repo, parse a directory tree, derive 4-byte selectors yourself,
and re-do that on every update.

Klarity mirrors the registry into Arkiv so **any developer, anywhere, can query
a clear-signing format by `chain + contract address + function selector`** with a
single request — no repo clone, no parsing, no selector math — and compose it
into their own app. Because Arkiv entities are on-chain, owned, and
permissioned, the mirror is verifiable and tamper-evident in a way a private
Postgres copy is not.

The mirror stays live via **two-way sync**:

- **GitHub → Arkiv** (open, automatic): every merge to the Ledger registry flows
  into Arkiv within minutes.
- **Arkiv → GitHub** (gated): an EF-authorized wallet submits a new/changed
  descriptor to Klarity; Klarity writes it to Arkiv **and** opens a pull request
  on the Ledger repo with full provenance.

## 2. Goals / non-goals / anti-goals

**Goals**
- One-request lookup: `(chainId, contractAddress, selector)` → ERC-7730 format.
- Queryable & composable: filter by chain, contract, function name, owner, intent.
- Faithful mirror of CC0 registry data, kept current automatically.
- Gated write-back: only allowlisted EF wallets can propose changes to Ledger.
- Easy to deploy: single TS service, env-configured, one `docker run` / `npm start`.
- Isolated & composable now; embeddable into a larger app later.

**Non-goals**
- Not a wallet / not a signer UI. Klarity serves data; it doesn't render it.
- Not a general-purpose GitHub bot. It syncs this one registry.
- No on-chain Klarity smart contract in phase 1 (allowlist is config-based).
- Not Sourcify data (explicitly excluded by the prize rules).

**Anti-goals (these make it a failure even if it "works")**
- Anyone being able to write an entity Klarity treats as authoritative, or open
  a Ledger PR, without an authorized signature. **This is the hard security line.**
- An infinite sync loop (our PR merges → ingest → re-write → re-PR → …).
- A schema so clever that a developer can't look up a contract in one query.

## 3. Who can change what (authority model)

| Actor | Can read Arkiv | Can write authoritative entities | Can open Ledger PR |
|---|---|---|---|
| Anyone (public) | ✅ (filtered to the registry wallet) | ❌ | ❌ |
| GitHub → Arkiv sync (ingest) | — | ✅ (mirrors merged files only) | ❌ |
| EF-authorized wallet (via Klarity REST) | ✅ | ✅ (triggers the write) | ✅ |
| Klarity service wallet | — | ✅ (the actual on-chain writer) | — |

Two distinct identities, deliberately separated (from research §4-auth):

- **REST signer** = the EF-authorized wallet. It signs an **EIP-712** message
  authorizing a specific descriptor write. Klarity checks it against an allowlist.
  This is the *authorization* layer.
- **Arkiv writer** = Klarity's own service wallet. It submits the Arkiv tx, so it
  becomes the on-chain `owner`/`creator` of every registry entity. This is what
  makes the data tamper-evident: **no other wallet can mutate these entities**,
  and readers filter `.createdBy(REGISTRY_WALLET)` to ignore any impostor entity
  written under the same schema namespace.
- The authorized signer is recorded inside each entity as `authorizedBy` for
  queryable provenance.

**Allowlist (phase 1):** `AUTHORIZED_WALLETS` env var — comma-separated
addresses, loaded into a lowercased `Set`. EF rotates it by updating config.
**Phase 2 (documented, not built):** an on-chain `AuthorizedSigners` contract EF
controls, read via `publicClient.readContract`, so authority is auditable and
rotatable without redeploy.

## 4. Architecture

```
                   ┌─────────────────────────────────────────────┐
                   │                 Klarity service              │
                   │                  (TypeScript)                │
                   │                                              │
  Ledger repo ───► │  ingest ──► normalize ──► ArkivWriter ──┐    │
  (GitHub)         │  (poll /    (descriptor   (SDK, service  │   │
      ▲            │   webhook)   → entities)   wallet)       ▼   │
      │            │                                     ┌─────────┐
      │            │  queryApi ◄───────────────────────► │  Arkiv  │
      │            │  (REST reads from Arkiv)            │  Rabdi  │
      │            │                                     └─────────┘
      │            │  writeApi (POST /descriptors)            ▲   │
      │            │   └─ EIP-712 verify + allowlist ─────────┘   │
      └──────PR────┤   └─ GitHubClient.openPR (fork-flow)         │
   (fork → upstream)│                                              │
                   └─────────────────────────────────────────────┘
```

### Components

1. **`ArkivClient`** — wraps `@arkiv-network/sdk`. Public client for reads,
   wallet client (service key) for writes. Holds the `ClearSignDescriptor`
   schema. Deterministic entity keys via `NO_SALT` + `predictEntityKey` so sync
   can **upsert by identity** (compute key → exists? patch : create).

2. **`importer` / `ingest`** — pulls descriptor files from the Ledger repo and
   writes/updates entities.
   - **GitHub → Arkiv:** poll `compareCommitsWithBasehead(lastSha...master)` on a
     timer (default) + optional webhook `push`/`pull_request merged` fast-path
     (HMAC-verified). Shared "apply changed files" code path. Persist
     `lastSyncedSha`.
   - **Normalizer:** one descriptor file → many entities, flattened per
     deployment `(chainId, address)` and per function signature. Derives the
     4-byte selector (`keccak256(canonicalSig)[0:4]`) — strips param names first.
   - **`includes` resolution:** descriptors can be partial and inherit from a
     shared fragment (`ercs/*.json` or sibling `common-*.json`) via `includes`.
     The normalizer **fetches the referenced fragment and deep-merges it** into
     the descriptor before flattening, so partial files (e.g. the DAI permit
     descriptor, which carries no `display.formats` of its own) become complete,
     queryable entities. Resolution is recursive and cached per fragment.
     **Validated against the whole registry: 475/740 descriptors (64%) use
     `includes`, depth ≤ 2 — this is the majority path, not an edge case.**
   - **`$ref` definition inlining:** 472/740 descriptors use `display.definitions`,
     and `fields[]` entries reference them via JSON pointers like
     `"$ref": "$.display.definitions.sendAmount"`. Before storing a format block,
     the normalizer **inlines each referenced definition into the field** (the
     field's own keys win on conflict) so the stored payload is **self-contained** —
     no dangling `$ref`, no external lookup required by the consumer.
   - **Emit-source exclusions:** `sigs/` (169 signed EIP-712 test fixtures, shape
     `{sig:{…,signature:{v,r,s}}}` — not descriptors), `tests/`, `testsv2/`,
     `*.tests.json`, and `common-*.json` (include-targets, resolved into others but
     never emitted directly) are all excluded as emit-sources. `common-*` and
     `ercs/*` are still **loaded** when referenced by `includes`.
   - **Both kinds mirrored:** calldata **and** eip712 descriptors. eip712 entities
     have no 4-byte selector — they are keyed by **primaryType** (see schema).
   - **Scale:** deployment fan-out per file is 1–177 (median 1; Safe multisig is on
     177 chains). Full backfill ≈ **16,364 entities** → batch writes + rate-limit
     backoff on the importer.

3. **`writeApi`** — `POST /descriptors`. Verifies the EIP-712 signature,
   recovers the signer, checks the allowlist, checks nonce + deadline + content
   hash, then: writes the entity via `ArkivClient`, and calls `GitHubClient` to
   open the Ledger PR. Exposes `GET /nonce/:address`.

4. **`GitHubClient`** — `@octokit/rest` behind one class (clean GitHub-App
   upgrade later). Fork-flow: ensure fork → branch off upstream HEAD →
   `createOrUpdateFileContents` → cross-repo `pulls.create` (`head: "<bot>:<branch>"`).
   Commit carries `Arkiv-Origin: true` + `Arkiv-Entity: <key>` markers.

5. **`queryApi`** — thin REST over Arkiv reads for devs who don't want the SDK:
   - `GET /descriptors/:chainId/:address/:selector` → the one format.
   - `GET /descriptors/:chainId/:address` → all formats for a contract.
   - `GET /descriptors?owner=&intent=&functionName=` → filtered list.
   Every query filters `.createdBy(REGISTRY_WALLET)`.

6. **`loop guard`** — canonical content-hash comparison (RFC 8785 JCS → keccak256)
   stored per descriptor. On ingest, if `hash(incoming) === storedHash`, skip.
   This is the mandatory guard; provenance marker + delivery-id dedupe layered on.
   (Same keccak256 the EIP-712 `descriptorHash` binds to — one hash algorithm everywhere.)

### Tech choices (my calls, for you to veto)
- **Language/runtime:** TypeScript on Node 22+ (Arkiv SDK needs 22.10+). Arkiv &
  viem are TS-native — least friction.
- **HTTP framework:** Fastify (fast, schema-validated, tiny) — open to Express if
  you prefer.
- **Canonical JSON:** `canonicalize` (RFC 8785) on both client and server.
- **Storage for sync state** (`lastSyncedSha`, used nonces, content hashes):
  SQLite via a tiny file (zero infra, easy deploy). Swappable.
- **Deploy:** one Dockerfile + `.env.example`; also `npm run start`. A seed
  script (`npm run import`) does the first full backfill.

## 5. Data flow walk-throughs

**Backfill (first run):** `import` script walks `registry/**/*.json` from the
Ledger repo at HEAD, normalizes each into per-deployment × per-function entities,
writes them to Arkiv with a long expiration, records `lastSyncedSha` = HEAD and
each descriptor's content hash.

**GitHub → Arkiv (a Ledger merge):** poll finds changed `registry/**/*.json`
files → for each, fetch content, canonical-hash, compare to stored; if changed,
normalize + upsert entities (deterministic key → patch or create), re-extend
expiration, update stored hash + `lastSyncedSha`. Byte-identical round-trips are
skipped (loop guard).

**Arkiv → GitHub (an authorized write):** client fetches `GET /nonce/:address`,
canonicalizes the descriptor, hashes it, signs the EIP-712 `DescriptorWrite`
struct, `POST /descriptors` with `{descriptor, signature, message}`. Server:
recompute hash == `message.descriptorHash`? → recover signer → in allowlist? →
`now <= deadline`? → `(signer, nonce)` unused? → then dispatch on `action`:
- `create` / `update` → upsert entity (`authorizedBy = signer`) → open Ledger PR
  (fork-flow) that adds/updates the descriptor file → return
  `{ entityKey, txHash, prUrl }`.
- `delete` → `deleteEntity` the Arkiv entity **and** open a Ledger PR that
  **removes the source file** (symmetric write-back) → return `{ txHash, prUrl }`.

## 6. What's left to the builder
- Exact Fastify route/validation wiring and error-response shapes.
- SQLite table DDL for `sync_state`, `used_nonces`, `descriptor_hashes`.
- Retry/backoff config for Octokit throttling plugins.
- The precise `fields[]` passthrough (stored whole in payload; no re-modeling).
- Test vectors: unit tests for selector derivation + canonical hashing + EIP-712
  recover; an integration test that backfills a handful of real descriptors to
  Rabdi and queries them back.

## 7. Judging deliverables (per prize rules)
Written alongside this plan, one file per criterion:
- `arkiv/schema.md` — entities, queried fields, ownership, expiration.
- `arkiv/friction.md` — Arkiv feedback (what got in the way / what's missing).
- `arkiv/reach.md` — who depends on this data, who'd use the copy.
- `arkiv/why-arkiv.md` — what Arkiv enables that Postgres can't.
- `arkiv/data-quality.md` — freshness, how import stays current, filterability.
- README: wallet address(es) that wrote the entities + one runnable query +
  AI-usage disclosure + CC0 license link.

## 8. AI usage disclosure (ETHGlobal rules)
This project was designed and built with Claude (Anthropic). Research into the
ERC-7730 format, Arkiv SDK, GitHub sync, and signature auth was done by parallel
AI research agents; synthesis, design, and implementation were AI-assisted and
human-directed. Detailed in the README.
