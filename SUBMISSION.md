# Klarity — Hackathon Submission

## Short description

> Always-on, decentralized clear-signing for Ethereum wallets: ERC-7730 registry mirrored to Arkiv.

**Character count: 97** (≤ 100 ✓)

---

## Description

When your wallet shows *"Approve unlimited USDC to 0x1f98…"* instead of a wall of hex, it is reading an **ERC-7730 clear-signing descriptor** — the primitive that stands between a user and blind signing, the single largest vector for drained wallets. The failure mode is the quiet part: if the wallet can't fetch that descriptor at signing time, it doesn't stop and warn you. It silently downgrades, shows raw hex, and asks you to sign anyway — exactly when an attacker's phishing calldata is the thing in front of you. Absence of this data isn't an error the user sees; it's the removal of the one safeguard engineered to catch the malicious transaction, delivered at the worst possible moment.

Today that security-critical dataset lives in **one GitHub repo**, and GitHub goes down — routinely. Its own public status log shows multiple Git Operations and API degradations in a typical two-week window (we cite only the dated, individual incidents from that log; we do not claim a cumulative annual downtime figure, because we could not verify one). Centralizing a wallet-security dataset behind a single host is not an uptime nuisance — it is **systemic risk**: one provider's bad afternoon degrades the security posture of every dependent wallet at once. ERC-7730's own security section names this exact class of threat — "front-end/CDN compromise" and "registry poisoning."

**Klarity mirrors the ERC-7730 clear-signing registry into [Arkiv](https://arkiv.network)** — a decentralized, permissionlessly-queryable entity store — as on-chain records keyed by `(chainId, contract, selector)`. A wallet resolves *"what does this transaction actually do"* in a single query by the identity it already holds, always available, with no host to take it down and no repo to clone, parse, and refresh. Descriptors arrive **self-contained** (every `includes` fragment deep-merged and every `$ref` inlined before storage) and **byte-verifiable** (a canonical hash anyone can recompute from the upstream file). Each entity carries on-chain provenance — every read is cryptographically pinned to the official writer wallet, so an impostor descriptor forged under the same schema is never returned — plus optional attestation and interaction-proven reputation signals, so consumers can *rank* descriptors by verified trust instead of trusting a flat list. Around the mirror: a **MetaMask Snap** that clear-signs at transaction time, a **Next.js Explorer** to browse and author descriptors, and a **wallet-signed authoring flow** that opens a pull request straight back to the upstream registry — turning a read-only mirror into a two-way contribution surface.

**Character count: 2,649**

---

## How it's made

**TypeScript, end to end** — ingest pipeline, Fastify read API, Arkiv client, EIP-712 auth gate, Next.js Explorer, and MetaMask Snap.

**The mirror / ingest pipeline.** Klarity walks every ERC-7730 descriptor, deep-merges each `includes` fragment and inlines every `$ref` so a stored record is fully self-contained (no second lookup, no fragment resolver for the consumer), then **flattens** one descriptor file — which declares many deployments across many chains and functions — into one entity per `(chainId, contract, selector)`, the exact granularity a wallet looks up. Records are upserted onto Arkiv's **Rabdi testnet** (`chainId 7794095`).

**One content hash, three jobs.** Content-addressing is **RFC 8785 (JCS) canonical JSON + keccak256** (`src/hash.ts`), and the *same* hash is reused by the Arkiv writer, the sync loop-guard that skips byte-identical files, and the EIP-712 signature layer that binds a signature to exact descriptor bytes — one canonicalization, byte-identical everywhere, so the three layers cannot disagree about what a descriptor *is*.

**Freshness.** A GitHub → Arkiv sync loop (`src/sync.ts`) keeps the mirror live two ways that share one "apply changed files" path: an incremental poll reads a stored sync cursor, asks GitHub `compareCommitsWithBasehead(cursor...master)` for exactly the changed files, and touches only those; an optional HMAC-verified `push`/merged-PR webhook is the near-instant fast-path. A one-shot backfill (`src/import.ts`) seeds the mirror from a local clone — resolving includes off the filesystem — behind a hand-rolled **~8-in-flight concurrency pool** over **~740 files / ~16.4k entities** (Arkiv has no batch-write, so the pool bounds Rabdi write pressure without a dependency).

**Reads.** The Fastify decode API and every SDK query run over **Arkiv JSON-RPC via viem `createPublicClient`** (`src/arkiv/client.ts`), each pinned `.createdBy(REGISTRY_WALLET)` — the load-bearing impostor-entity trust filter, centralized in the client so no call site can forget it. Routes: `/decode`, `/descriptors/:chainId/:address/:selector`, `/descriptors/:chainId/:address`, and filtered `/descriptors?…` browse over any indexed attribute. (No `/health` route.)

**Writes.** A write is gated by an **EIP-712 `DescriptorWrite` signature** (`src/auth.ts`), verified fail-fast in a deliberate order — recomputed hash matched first, then deadline, then an Ethereum-Foundation allowlist, and the replay-nonce consumed **last** so a request failing any earlier check never burns a legitimate `(signer, nonce)` pair. An authorized write then opens an automated **cross-repo fork-flow PR** back to upstream (`src/github.ts`: ensure fork → branch off HEAD → commit with loop-guard markers → `pulls.create`), recording `authorizedBy` + `source` on the entity so the authority behind every row is on-chain, not buried in a log. An optional **EAS attestation** (`src/eas/attester.ts`) binds an EF-gate UID + attester onto the row for reputation.

**The Explorer (Next.js 15 / React 19).** Browse companies, contracts, and calls; a two-panel **raw-vs-clear-sign** decode view; and an `/add` flow where a descriptor is signed **in-browser** with MetaMask `eth_signTypedData_v4` (plus a Rabdi `wallet_switchEthereumChain` / `wallet_addEthereumChain` step). A `/pitch` route serves the SVG deck.

**The MetaMask Snap.** It decodes at `onTransaction`, and to render *"1.0 USDC"* instead of a raw integer it reads the token's `decimals()` and `symbol()` on-chain via **two raw EIP-1193 `eth_call`s** against the injected provider — not viem, which is server-side only. It also offers an **interaction-proven ranking vouch**: only attested after the voucher's *own mined transaction* to the contract is verified (`eth_getTransactionReceipt`), so a forged or unmined claim is refused.

**Honest by construction.** The decode never fabricates: any ABI/path/body failure degrades a field to labels-only rather than inventing a value, and an unresolved inner call renders an explicit *"unknown"* marker — it fails toward "I don't know," never toward a confident wrong answer. Two real Arkiv constraints shaped the schema: `bytes` columns aren't indexable, so the headline `selector` is an **indexed `str` holding its 0x-hex** so the project's most important query can filter on it; and no deterministic key derives from your data (keys come from `owner`/`nonce`, not attributes), so every upsert is **query-then-patch-or-create**, made idempotent by the content-hash loop guard.

**Why Arkiv was the right partner.** Permissionless reads over plain JSON-RPC (no account, no connection string, no operator in the loop) — the bounty's literal premise, which a Postgres box with an owner and a bill can't offer. Cryptographic provenance: every read pinned `.createdBy(REGISTRY_WALLET)` makes forged same-schema entities structurally invisible, and entities are tamper-evident because only the service wallet can mutate them. Always-availability instead of a GitHub single-point-of-failure. And `permissionlessExtension: true` lets the community keep the mirror alive — extending entity lifetimes — **without being able to edit a single field**, decoupling who-keeps-it-alive from who-can-change-it: exactly what a security dataset wants and a conventional database cannot give.

**Character count: 5,304**

---

## Verification notes

Every technical claim above was checked against the repository at build time:

- `src/hash.ts` — RFC 8785 (JCS) + keccak256, shared helper. ✓
- `src/auth.ts` — EIP-712 `DescriptorWrite`, fail-fast order hash → deadline → allowlist → replay-nonce-last. ✓
- `src/arkiv/client.ts` — viem `createPublicClient`, `.createdBy` pinning, query-then-patch-or-create, `permissionlessExtension: true`, `str` selector, `fromDays(180)`. ✓
- `src/import.ts` — includes/`$ref` resolution, flatten to `(chainId, contract, selector)`, `runPool` with concurrency = 8, ~740 files / ~16.4k entities. ✓
- `src/sync.ts` / `src/github.ts` — compare-sha incremental poll, webhook, cross-repo fork PR via `pulls.create`. ✓
- `src/eas/attester.ts` — optional EF-gate attestation (UID + attester). ✓
- `snap/src/token.ts` + `snap/src/index.ts` — ERC-20 `decimals()`/`symbol()` via two raw EIP-1193 `eth_call`s (not viem); `onTransaction` decode. ✓
- `snap/src/ranking.ts` — interaction-proven vouch gated on the voucher's own mined tx (`eth_getTransactionReceipt`). ✓
- `web/` — Next.js 15 / React 19; `/add` uses `eth_signTypedData_v4` + `wallet_switchEthereumChain`/`wallet_addEthereumChain`; `/pitch` deck. ✓ (route presence confirmed in `web/app/`; version numbers taken from the task brief / `web/package.json` convention, not independently diffed)

**Could not fully verify / intentionally not claimed:**
- No cumulative annual GitHub-downtime percentage — only the dated individual incidents from GitHub's own status log, consistent with `PITCH.md` / `arkiv/why-arkiv.md`.
- Outage incident dates are current (per the honesty flag), not asserted as 2025; the Description cites them only as "a typical two-week window" without pinning specific dates.
- The `~740` / `~16.4k` / `~16 chains` figures are reproduced from `scripts/analyze.mjs` / README; stated as approximate.
- No specific wallet product's live consumption of the registry is claimed beyond ERC-7730's vendor-neutral design and the registry's documented consumption path.
