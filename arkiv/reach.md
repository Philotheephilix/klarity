# Reach — who depends on this data

> The judged question: *How many people and projects already use or depend on this data? Who would use the Arkiv copy after the event, and for what?*

Short version: **clear-signing descriptors sit on the security-critical path of every wallet that wants to show users what they are signing.** The dataset is small in bytes and enormous in blast radius — it is consulted at the exact moment a user is about to approve a transaction. Mirroring it to Arkiv puts that path on a substrate nobody can take down.

---

## Who depends on the source data today

### The standard: ERC-7730

ERC-7730 ("Structured Data Clear Signing Format") is an Ethereum standard, authored out of **Ledger**, whose stated purpose is "significantly improved signing user experiences and lower end-user risk from frontend and phishing attacks" ([EIP-7730](https://eips.ethereum.org/EIPS/eip-7730)). It is the open format wallets use to turn opaque calldata and EIP-712 messages into a human-readable sentence before signing. The spec itself calls clear signing "a key element of good security practices."

### The registry: the canonical open dataset

The descriptors live in the **clear-signing ERC-7730 registry**, originated by Ledger at [`LedgerHQ/clear-signing-erc7730-registry`](https://github.com/LedgerHQ/clear-signing-erc7730-registry) and also mirrored under the Ethereum organization at [`ethereum/clear-signing-erc7730-registry`](https://github.com/ethereum/clear-signing-erc7730-registry). Verified from the repositories at build time:

- **Content license: CC0-1.0** (public-domain dedication) — anyone may mirror it, which is exactly what makes a bounty like this legitimate.
- **224 forks, 131 stars** on the canonical repo — a fork count in the hundreds is a direct signal of how many downstream tools and vendors have taken a copy to build against.
- **~559 commits** of community curation and growing.
- Wallets consume it through two generated root index files, `index.calldata.json` and `index.eip712.json`, both keyed by **CAIP-10** `eip155:$chainId:$address` identifiers, so a wallet "can find the right descriptor for a transaction without downloading the whole registry." *That lookup path is precisely what Klarity turns into a single Arkiv query.*

### The dataset, measured

From our own analysis pass over a full clone (`scripts/analyze.mjs`, the same walk the importer uses):

- **~740 emit-source descriptor files** across protocol directories (Aave, 1inch, Lido, Morpho, Safe, CoW Protocol, ENS, Paraswap, LiFi, and dozens more).
- These flatten to **~16.4k queryable entities**, one per `(chainId, contract, selector)` — because one descriptor file declares many deployments across many chains and many functions.
- **Both kinds** of signing payload: `calldata` (keyed by 4-byte selector) and `eip712` typed messages.
- **~16 EVM chains** covered: Ethereum mainnet (1), Optimism (10), Gnosis (100), Polygon (137), Sonic (146), Metis (1088), Base (8453), Arbitrum (42161), Avalanche (43114), Linea (59144), Scroll (534352), and more.

### The consumers

Anyone implementing ERC-7730 is a consumer: hardware wallets, software wallets, transaction-simulation services, and preview tooling. Ledger originated the standard and registry for its own clear-signing stack; the format is deliberately vendor-neutral so **any** wallet can adopt it, and the registry is the canonical open dataset the ecosystem points at. *(We state the vendor-neutral design and Ledger origin as verified from the spec and repo; we do not claim a specific product's live consumption beyond what those sources state.)*

---

## Who uses the Arkiv copy after the event

The Arkiv mirror (`sourcePath`-faithful, keyed by the same identity the ecosystem already uses) is useful to anyone who today has to clone-and-parse the repo:

1. **Wallet and signing-framework developers** — the primary audience. Instead of shipping a parser, a selector-deriver, and a refresh job, they issue **one query** by `(chainId, contract, selector)` and get the format block to render. Integration cost drops from "build a pipeline" to "make a request." Crucially, they also gain a fetch path that does not go down when GitHub does (see `why-arkiv.md`).
2. **Transaction-preview / simulation services** — the "confirm" modals that need to label a call at runtime. They need availability and low-latency lookup, both of which a queryable decentralized substrate gives directly.
3. **Block explorers and analytics** — to show intent ("Repay loan", "Supply") next to a decoded call, joined by contract + selector.
4. **Other Arkiv builders** — a ready-made, composable on-chain dataset to join against their own entities (token lists, address labels) in the same query layer, with no cross-silo ETL.
5. **A write-back contribution surface** — Klarity's gated, EF-wallet-authorized write path lets an authorized party propose a registry addition *through* Arkiv and have it land as an upstream PR (`src/github.ts`, `openDescriptorPR`). That is a new, programmatic way to contribute to the registry, with the authorizing wallet recorded on-chain.
6. **The MetaMask Snap we built** (`snap/`) is itself a live consumer: it fetches Klarity descriptors to clear-sign a pending transaction inside MetaMask Flask, then (human-gated) captures an interaction-proven reputation vouch — a worked example that this copy is consumable today, not just theoretically.

---

## Why reach *grows* on Arkiv rather than merely moving

The source has exactly one access pattern: clone or hit the rate-limited GitHub contents API, then parse a directory tree. That is a real tax, and it is the reason most would-be consumers never integrate clear signing at all. The Arkiv copy is a **queryable, composable, globally-readable, no-gatekeeper** dataset — any developer anywhere queries it by the keys they actually search on, without asking anyone for access and without standing up an indexer. Lowering the integration cost is how a dataset that *should* be everywhere actually gets there.

> Every count above is reproducible: the README links the canonical repo and a runnable query, and `scripts/analyze.mjs` regenerates the file/entity/chain counts from a fresh clone.
