# Klarity — Hackathon Submission

## Short description

> A censorship-proof Ethereum wallet with clear-signing: on-chain UI, anonymous RPC, Arkiv registry.

**Character count: 98** (≤ 100 ✓)

---

## Description

Klarity is two things that need each other: an **indestructible, untraceable Ethereum wallet**, and the **clear-signing security data** that wallet depends on — both engineered so no single server, company, or court can take them down.

Start with the wallet. Every wallet you've used loads its interface from a server that can be hacked, phished, domain-hijacked, or seized, and sends its RPC through a handful of providers that see your IP and your entire portfolio. Klarity removes both. Its UI is served **directly from a smart contract** via **ERC-8244** (`html()` as a gas-free view call) or from a **content-addressed IPFS bundle** — there is no website to compromise, and the interface lives in the same trust domain as the bytecode it drives. Its JSON-RPC rides an **anonymizing transport** (anon-rpc) in a hash-pinned, null-origin sandboxed worker, Tor- or Nym-routed, so the destination RPC never learns who is asking. It is reached as **`klarity.eth`**, whose ENS contenthash points at the pinned CID, resolvable through any ENS gateway (`eth.limo`, Brave, ENS-native browsers) with nothing we host in between. The account itself is an **ERC-4337 smart account** controlled by a WebAuthn/passkey — no seed phrase to leak. Name-addressed, content-addressed, anonymized: a wallet with no off switch.

Now the data that makes it safe. When a wallet shows *"Approve unlimited USDC to 0x1f98…"* instead of a wall of hex, it is reading an **ERC-7730 clear-signing descriptor** — the one safeguard standing between a user and blind signing, the single largest vector for drained wallets. If the wallet can't fetch that descriptor at signing time it doesn't stop and warn you; it silently downgrades to raw hex and asks you to sign anyway — exactly when an attacker's phishing calldata is in front of you. Yet today that security-critical dataset lives in **one GitHub repo**, and GitHub goes down routinely (its own status log shows repeated Git/API degradations in a typical two-week window; we cite only dated incidents, not an unverified annual figure). A wallet engineered to have no single point of failure cannot read its security data from one.

So Klarity mirrors the entire ERC-7730 registry into **[Arkiv](https://arkiv.network)** — a decentralized, permissionlessly-queryable entity store — keyed by `(chainId, contract, selector)`, byte-verifiable and provenance-pinned, with a **two-way GitHub↔Arkiv sync** for backwards compatibility (poll/webhook in, authorized pull-request back out). The whole path — UI, transport, and signing data — is equally un-takedownable. Around it: a MetaMask Snap that clear-signs at transaction time, a Next.js Explorer to browse and author descriptors, and attestation/reputation signals so consumers rank descriptors by *verified* trust.

**Character count: ~2,650**

---

## How it's made

**TypeScript, end to end**, across two repos: `klarity` (registry mirror, Fastify API, Arkiv client, EIP-712 auth, Explorer, Snap) and `klarity-wallet` (the ERC-8244 / anon-rpc / ENS wallet).

### The wallet (klarity-wallet)

**UI with no host — ERC-8244.** `contracts/HtmlHost.sol` serves the wallet document from `html()` (selector `0x33c34ac3`), a gas-free `view`. Because the document exceeds the EIP-170 24KB code cap, its bytes are stored as the runtime code of one or more **SSTORE2 data contracts** (each prefixed with a `STOP` guard so data can never execute) and stitched back with `extcodecopy` at read time. The host fetches `html()` **through the anon transport** (so even loading the UI is anonymized) and mounts it in a `sandbox="allow-scripts"`, null-origin iframe; per ERC-8244 the document is untrusted, so the origin address + chain id are rendered by the host *outside* the frame and every signing request is gated by a host-side confirmation.

**Anonymous RPC.** `src/lib/anonTransport.ts` wraps `@anon-rpc/browser-harness`'s `AnonRpcWorker` — an anonymizing client in its own null-origin sandboxed iframe + Web Worker. A `worker.fetch` tunnels each request to a swappable, untrusted destination RPC; an on-chain **specifier** (content-addressed by keccak256) picks the carrier: `passthrough` (dev), `torJs` (real Tor through an operator-run gateway), or `nym`. `anonViemTransport()` exposes it as a viem custom transport, so both chain reads and the ERC-4337 bundler POST ride the anon network — no JSON-RPC leaves over clearnet at runtime.

**Name + content addressing — ENS + IPFS.** The production build is a static, relative-path bundle; `scripts/pin-ipfs.mjs` pins `dist/` as a wrapped directory → CIDv1, and `scripts/set-contenthash.mjs` encodes that CID (`@ensdomains/content-hash` ipfs codec + `packetToBytes`) into **`klarity.eth`'s contenthash** on an ENS v2 resolver (simulating first to surface a missing-role revert before spending gas). An ENS-aware gateway then resolves the name → contenthash → self-contained UI, server-lessly. The account is ERC-4337 + passkey/PRF (`src/lib/account.ts`).

### The registry mirror (klarity)

**Ingest + one hash, three jobs.** The pipeline deep-merges every `includes`/`$ref` so stored records are self-contained, flattens each descriptor to one entity per `(chainId, contract, selector)`, and upserts to Arkiv's **Rabdi** testnet. Content-addressing is **RFC 8785 (JCS) + keccak256** (`src/hash.ts`), reused identically by the Arkiv writer, the sync loop-guard, and the EIP-712 signature layer.

**Two-way sync.** `src/sync.ts` keeps GitHub → Arkiv fresh (incremental `compareCommitsWithBasehead` poll + optional HMAC webhook); the signed-write path opens a cross-repo fork PR Arkiv → GitHub (`src/github.ts` `openDescriptorPR`), so the mirror stays backwards-compatible with the canonical registry. A one-shot backfill (`src/import.ts`) seeds ~740 files / ~16.4k entities behind a hand-rolled ~8-in-flight pool.

**Reads + writes.** Reads run over Arkiv JSON-RPC via viem `createPublicClient`, each pinned `.createdBy(REGISTRY_WALLET)` — the impostor-entity trust filter. Writes are gated by an EIP-712 `DescriptorWrite` signature (`src/auth.ts`, fail-fast: hash → deadline → allowlist → replay-nonce-last), with optional EAS attestation for reputation.

**The Snap.** Decodes at `onTransaction`, reading ERC-20 `decimals()`/`symbol()` via two raw EIP-1193 `eth_call`s; offers an interaction-proven ranking vouch gated on the voucher's own mined transaction.

**Honest by construction.** The decode never fabricates — any ABI/path/body failure degrades a field to labels-only; unresolved inner calls render an explicit *"unknown"*.

**Why Arkiv.** Permissionless reads over plain JSON-RPC (the bounty's premise, which a Postgres box with an owner and a bill can't offer), on-chain provenance via `.createdBy`, always-availability vs. the GitHub single-point-of-failure, and `permissionlessExtension: true` — the community keeps the mirror alive without being able to edit a field.

**Character count: ~3,800**

---

## Verification notes

Checked against both repositories:

- **klarity** (pinned @ `a5ed241`): `src/hash.ts` (JCS + keccak256), `src/auth.ts` (EIP-712 fail-fast order), `src/arkiv/client.ts` (`createPublicClient`, `.createdBy`, `permissionlessExtension`), `src/import.ts` (includes/`$ref`, flatten, concurrency pool), `src/sync.ts` + `src/github.ts` (two-way sync, `pulls.create`), `snap/src/token.ts` (two raw `eth_call`s, not viem), `snap/src/ranking.ts` (mined-tx vouch). ✓
- **klarity-wallet** (branch `main`): `contracts/HtmlHost.sol` (ERC-8244 `html()`, SSTORE2 + `extcodecopy`), `src/lib/anonTransport.ts` (`AnonRpcWorker`, passthrough/torJs/nym specifiers), `scripts/set-contenthash.mjs` (IPFS contenthash encode → `setContenthash`), `scripts/resolve-mainnet-ens.mjs` (Universal Resolver). ✓

**Could not fully verify / intentionally not claimed:**
- Anonymous RPC: Tor/Nym is the real capability, but `passthrough` is the **dev default** (`torJs` is opt-in via `VITE_USE_TOR=1`) — the wallet *can* Tor-route all RPC; it is not asserted as on-by-default.
- "No servers" describes the **wallet's** target architecture (ERC-8244 + IPFS + anon-rpc); the Explorer and read API are currently hosted on Vercel / a workstation — not claimed as decentralized.
- No cumulative annual GitHub-downtime percentage — only dated incidents from GitHub's own status log.
- `~740` / `~16.4k` / `~16 chains` are approximate, reproduced from `scripts/analyze.mjs` / README.
- `klarity.eth` resolution via `eth.limo` is a property of the ENS contenthash standard, not custom code in the repo.
