# Klarity

**Decentralized, always-available clear-signing for Ethereum — a security data layer *and* an indestructible wallet, because wallet security should not depend on anyone's uptime.**

## 🚀 Live deployment

| What | URL |
|------|-----|
| **Explorer** (browse + author descriptors, decode view, pitch) | **https://klarity-explorer.vercel.app** |
| **Snap installer** (one-click install into MetaMask Flask) | **https://klarity-installer.vercel.app** |
| **MetaMask Snap** (published, live backend baked in) | **`npm:@philotheephilix/klarity-snap`** — [npm](https://www.npmjs.com/package/@philotheephilix/klarity-snap) |
| **Read / decode API** (queryable registry mirror) | **https://mcp.philotheephilix.in/mumbai/klarity-api** |
| **Pitch deck** | **https://klarity-explorer.vercel.app/pitch** |
| **Klarity Wallet** (indestructible, censorship-resistant smart account) | **`klarity.eth`** — [Open wallet](https://klarity.eth.limo) · [klarity-wallet repo](https://github.com/Philotheephilix/klarity-wallet) |

Quick check the API is live:

```bash
curl "https://mcp.philotheephilix.in/mumbai/klarity-api/descriptors?entityName=aave"
```

See [Deployment](#deployment) for how each piece is hosted.

## The Klarity Wallet

Clear-signing data only helps if the wallet reading it can't itself be taken down.
So Klarity also ships an **indestructible, censorship-resistant Ethereum wallet** —
an ERC-4337 smart account controlled by a WebAuthn/passkey (no seed phrase),
built so that no server we run and no single point of infrastructure can kill it:

- **UI with no host** — the interface is delivered from content-addressed storage
  (IPFS CIDv1) *or* directly from a contract via
  [ERC-8244](https://ethereum-magicians.org/t/erc-8244-contract-hosted-application-html/28407)
  (`html()` served on-chain), rendered in a null-origin sandboxed iframe.
- **Anonymous RPC** — every `eth_call` and bundler POST rides an anonymizing
  transport ([`@anon-rpc`](https://www.npmjs.com/package/@anon-rpc/browser-harness):
  passthrough / Tor gateway / Nym) in a hash-pinned sandboxed worker; the
  destination RPC never sees who is asking.
- **Name-addressed** — reachable as **`klarity.eth`**, whose ENS contenthash points
  at the pinned CID, so the name is the stable entry point and the UI behind it can
  be re-pinned without moving.

No seed phrase, no server we run, name-addressed, content-addressed, anonymized.
**Full architecture and the five delivery/transport subsystems live in the
[`klarity-wallet`](https://github.com/Philotheephilix/klarity-wallet) repo.**

## Why this exists

When a wallet shows you *"Approve unlimited USDC to 0x1f98…"* instead of a wall of
hex, it is reading a **clear-signing descriptor** defined by
[ERC-7730](https://eips.ethereum.org/EIPS/eip-7730). Those descriptors are what
stand between a user and **blind signing** — the single largest vector for drained
wallets. If the wallet can't fetch the descriptor at signing time, it does not
stop; it falls back to showing raw hex and asks the user to sign anyway, at the
exact moment an attacker's phishing calldata is in front of them.

Today that security-critical dataset lives in **one GitHub repo**, and GitHub goes
down — routinely. GitHub's own status history shows multiple incidents touching
Git Operations and the API in a typical two-week window (including a **~7.5-hour**
Git Operations degradation on Nov 3, 2026). Centralizing a wallet-security dataset
behind a single host is a systemic risk: one provider's bad afternoon degrades the
security posture of every dependent wallet at once.

**Klarity mirrors the ERC-7730 clear-signing registry into
[Arkiv](https://arkiv.network)** — a decentralized, queryable data substrate — as
on-chain entities keyed by `(chainId, contract, selector)`. The data becomes
always-on, censorship-resistant, provenance-verifiable, and directly queryable by
anyone, with no single host to take it down and no repo to clone and parse. Each
entity can also carry attestation/reputation signals, so consumers can *rank*
descriptors by verified trust instead of trusting a flat list — a trust model that
only makes sense on a decentralized, attestable substrate.

See the judged write-ups in [`arkiv/`](arkiv/): [reach](arkiv/reach.md),
[why Arkiv](arkiv/why-arkiv.md), [data quality](arkiv/data-quality.md),
[Arkiv feedback](arkiv/friction.md), and the [schema reference](arkiv/schema.md).

## How it works

Klarity walks every descriptor in the registry, resolves `includes` fragments and
`$ref` pointers into self-contained records, flattens each descriptor into one
entity per `(chainId, contract, selector)`, and upserts them onto the Rabdi
testnet — then keeps the mirror fresh with an incremental GitHub sync loop and
serves the result over a small read API. The payoff: a wallet can look up "what
does this calldata / EIP-712 payload mean" by `(chainId, contract, selector)` in a
single Arkiv query instead of cloning and parsing the whole registry.

## Service wallet (writer of all entities)

Every `ClearSignDescriptor` entity is created and patched by one service wallet.
Reads are pinned with `.createdBy(<this wallet>)`, so impostor entities written by
any other key are never returned.

| | |
|---|---|
| **Registry wallet** | `0x9236c57BaeB306d5F4BB9E6E2A5f15B74C1aF305` |
| **Chain** | Rabdi testnet (`chainId 7794095`) |
| **RPC** | `https://rpc.rabdi.db-chain.testnet.arkiv.network` |

## Query examples

Each entity carries the indexed attributes `chainId`, `contract`, `selector`,
`functionName`, `kind` (`calldata` | `eip712`), `intent`, `entityName`,
`contractName`, `owner`, `sourcePath`, `source`, `authorizedBy`,
`eip712PrimaryType`, `attestationUID`, and `attester` (plus the non-indexed
`contentHash`, `body`, `bodyHash`, and `schemaVersion`). The headline lookup is by
`(chainId, contract, selector)` — `selector` is the 4-byte calldata selector (or
the EIP-712 primary-type typeHash prefix) stored as a `0x…` hex **string** so it
is indexable (the SDK cannot index a `bytes` column — see
[`arkiv/friction.md`](arkiv/friction.md)).

### Via the Arkiv SDK

```ts
import { createPublicClient } from '@arkiv-network/sdk';
import { and, eq } from '@arkiv-network/sdk/query';
import { u64, addr, str } from '@arkiv-network/sdk/schema';
import { rabdi } from '@arkiv-network/sdk/chains';
import { http } from 'viem';
import { ClearSignDescriptor } from './src/arkiv/schema.js';

const REGISTRY_WALLET = '0x9236c57BaeB306d5F4BB9E6E2A5f15B74C1aF305';
const reader = createPublicClient({
  chain: rabdi({ accessKey: process.env.ARKIV_ACCESS_KEY ?? '' }),
  transport: http('https://rpc.rabdi.db-chain.testnet.arkiv.network'),
});

// Aave WrappedTokenGatewayV3.depositETH on Ethereum mainnet.
const page = await reader
  .select({
    chainId: true, contract: true, selector: true,
    functionName: true, intent: true, kind: true, sourcePath: true,
  })
  .from(ClearSignDescriptor)
  .where(and([
    eq('chainId', u64(1n)),
    eq('contract', addr('0xd01607c3c5ecaba394d8be377a08590149325722')),
    eq('selector', str('0x474cf53d')),
  ]))
  .createdBy(REGISTRY_WALLET)   // impostor-entity trust filter
  .limit(1)
  .fetch();

console.log(page.entities[0]);
```

### Via the HTTP API (JSON-RPC-backed reads)

The service also exposes a thin read API over the same Arkiv queries. Routes
(see `src/routes/query.ts`):

- `GET /descriptors/:chainId/:address/:selector` — one descriptor by identity
- `GET /descriptors/:chainId/:address` — all formats for a contract
- `GET /descriptors?chainId=…&contract=…&kind=…` — filtered browse (any indexed attr)

See [`docs/API.md`](docs/API.md) for the full reference (read routes, the signed
`POST /descriptors` write route, and the GitHub webhook), with request/response
shapes and status codes.

```bash
# One descriptor by (chainId, contract, selector):
curl 'http://localhost:3000/descriptors/1/0xd01607c3c5ecaba394d8be377a08590149325722/0x474cf53d'
```

Each read is served by Arkiv's JSON-RPC endpoint under the hood (`createPublicClient`
→ `http(RABDI_RPC)`), pinned to the service wallet as shown above.

## Running the backfill (`npm run import`)

`npm run import` runs the one-shot backfill: it walks a **local clone** of the
registry, resolves every `includes` fragment from the filesystem (the incremental
sync loop defers include-bearing files — the backfill is what resolves them), and
upserts all descriptors, then parks the sync cursor at the upstream head so the
incremental loop resumes cleanly.

```bash
# 1. Clone the upstream registry somewhere local.
git clone https://github.com/LedgerHQ/clear-signing-erc7730-registry

# 2. Build.
npm ci
npm run build

# 3. Run the backfill, pointing REGISTRY_ROOT at the clone.
ARKIV_PRIVATE_KEY=0x…  \
ARKIV_RPC_URL=https://rpc.rabdi.db-chain.testnet.arkiv.network \
ARKIV_CHAIN_ID=7794095 \
GITHUB_TOKEN=ghp_…  \
REGISTRY_ROOT=./clear-signing-erc7730-registry \
  npm run import
```

Or in Docker. `loadConfig` validates **all** required vars at boot (it throws a
`ConfigError` before any work if one is missing), so pass every one with `-e`:

```bash
docker run --rm \
  -e ARKIV_PRIVATE_KEY=0xyourprivatekey \
  -e ARKIV_RPC_URL=https://rpc.rabdi.db-chain.testnet.arkiv.network \
  -e ARKIV_CHAIN_ID=7794095 \
  -e GITHUB_TOKEN=ghp_yourtoken \
  -e REGISTRY_ROOT=/registry \
  -v "$PWD/clear-signing-erc7730-registry:/registry" \
  klarity npm run import
```

Required environment variables:

| Var | Purpose |
|---|---|
| `ARKIV_PRIVATE_KEY` | Hex `0x…` key of the writer wallet |
| `ARKIV_RPC_URL` | Arkiv JSON-RPC HTTP endpoint (Rabdi) |
| `ARKIV_CHAIN_ID` | `7794095` (Rabdi) |
| `REGISTRY_ROOT` | Path to the local registry clone the backfill walks |
| `GITHUB_TOKEN` | Token used to read the upstream head sha for the cursor |

`runImport` is idempotent: a second run over unchanged files is entirely skipped
(a per-file `descriptorHash` loop guard matches the stored hash), so re-running is
safe. See `.env.example` for the full config surface and the HTTP server options.

The backfill is batched with a small concurrency pool (8 files in flight) so it can
chew through the ~740 emit descriptors / ~16.4k entities without overwhelming the
Arkiv writer.

## Deployment

Klarity ships as four independently-hosted pieces. The table in
[Live deployment](#-live-deployment) has every public URL.

| Piece | Source | Hosted on | How |
|-------|--------|-----------|-----|
| **API server** | `src/` (Fastify read/decode + signed-write) | Self-hosted Docker on a Tailscale workstation (OCI ARM, Mumbai), public via a Caddy reverse proxy at `mcp.philotheephilix.in` | `docker compose up -d` behind Caddy `handle_path /mumbai/klarity-api/*` → `klarity-api:3000` |
| **Explorer** | `web/` (Next.js 15 / React 19) | Vercel (`klarity-explorer`) | `vercel --prod`; `NEXT_PUBLIC_KLARITY_API_BASE` → the live API |
| **Snap installer** | `snap/.scratch/connect.html` (static page) | Vercel (`klarity-installer`) | static deploy; `SNAP_ID = npm:@philotheephilix/klarity-snap` |
| **MetaMask Snap** | `snap/` (`mm-snap build` → `dist/bundle.js`) | npm registry | `npm publish --access public`; the live API URL is baked into the bundle |
| **Klarity Wallet** | [`klarity-wallet`](https://github.com/Philotheephilix/klarity-wallet) repo | No host we run — IPFS (CIDv1) + ERC-8244 on-chain `html()`, named via ENS | pin `dist/` → IPFS, write the CID into `klarity.eth` contenthash, and/or deploy `HtmlHost.sol`; RPC tunneled through the anon transport |

### API server (Docker + Caddy)

The API is containerized from the repo's `Dockerfile` (two-stage Node 22 build →
`node dist/server.js`) and runs on the workstation's shared Docker network so the
existing Caddy ingress can reach it by name. Caddy terminates TLS (Let's Encrypt)
for `mcp.philotheephilix.in` and routes a path prefix to the container:

```
# Caddyfile (inside the mcp.philotheephilix.in site block)
handle_path /mumbai/klarity-api/* {
    reverse_proxy klarity-api:3000
    encode zstd gzip
}
```

`handle_path` strips the `/mumbai/klarity-api` prefix, so the app's own routes
(`/decode`, `/descriptors`, …) resolve unchanged. The container reads its
`ARKIV_*` / `GITHUB_*` config from a `.env` placed on the host (never committed),
and `docker compose` restarts it `unless-stopped`.

### Explorer (Vercel)

`web/` is a standard Next.js app. The browser talks to the API through the
same-origin `/klarity-api` rewrite (see `web/next.config.mjs`), with
`NEXT_PUBLIC_KLARITY_API_BASE` set on the Vercel project to the live API URL, so
no CORS and no hardcoded origin in the client.

### Snap + installer

`npm run build` in `snap/` compiles the Snap and writes `dist/bundle.js` with the
live API URL baked in (`src/config.ts`); `mm-snap` keeps the manifest `shasum` in
sync. It is published to npm as `@philotheephilix/klarity-snap` (a `files`
allowlist ships only `dist/bundle.js`, `images/`, and the manifest). The installer
is a one-file static page that calls `wallet_requestSnaps({ 'npm:@philotheephilix/klarity-snap': {} })`
— open it in a browser with **MetaMask Flask** installed and approve the dialog.

## Upstream registry & license

Descriptors are sourced from the ERC-7730 clear-signing registry, originated by
Ledger at <https://github.com/LedgerHQ/clear-signing-erc7730-registry> and also
mirrored under the Ethereum org at
<https://github.com/ethereum/clear-signing-erc7730-registry>. That registry's
descriptor content is published under **CC0-1.0** (public-domain dedication);
Klarity mirrors it verbatim (normalized into entities) and adds only provenance
metadata.

## AI-usage disclosure

This backend was built with AI assistance.
