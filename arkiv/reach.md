# Reach — who depends on this data

> How many people or projects already use or depend on this data? Who would use
> your copy on Arkiv after Mumbai, and for what?

## Who depends on the source data today

The ERC-7730 clear-signing registry is maintained by **Ledger** and lives under
the **Ethereum org on GitHub** (`ethereum/clear-signing-erc7730-registry`). It is
the data that lets a wallet show a human "you are supplying X to Aave" instead of
a raw calldata blob.

- **~84 submitting entities** — Aave, 1inch, Lido, Morpho, Safe, CoW Protocol,
  ENS, OKX, Paraswap, LiFi, and more.
- **Hundreds of descriptors** (calldata + EIP-712), each fanning out to many
  deployments.
- **~16 EVM chains** covered: Ethereum mainnet (1), Optimism (10), Gnosis (100),
  Polygon (137), Sonic (146), Metis (1088), Base (8453), Arbitrum (42161),
  Avalanche (43114), Linea (59144), Scroll (534352), plus others and testnets.
- **Consumers:** Ledger devices/Ledger Live use ERC-7730 directly; the standard
  (EIP-7730) is designed for *any* wallet to adopt. The registry is the canonical
  open dataset behind clear signing.

## Who uses the Arkiv copy after Mumbai

- **Wallet & dapp developers** who want clear-signing data without cloning a repo
  and parsing a directory tree: one query by `chain + address + selector` returns
  the format to render. This is the primary audience.
- **Transaction-preview / simulation tools** (e.g. the kind embedded in dapp
  "confirm" modals) that need to label a function call at runtime.
- **Block explorers & analytics** that want to show intent ("Repay loan") next to
  a decoded call.
- **Other Arkiv builders** who want a ready-made, composable on-chain dataset to
  join against (e.g. combine with a token-list or address-label mirror).
- **Ledger / EF themselves** indirectly: the gated write-back path means an
  authorized party can propose registry additions *through* Arkiv and have them
  land as a Ledger PR — a new contribution surface.

## Why the reach grows on Arkiv

The source is one repo with one access pattern (clone + parse). The Arkiv copy is
a **queryable, composable, globally-readable** API with no gatekeeper — any
developer anywhere queries it directly, by the keys they actually search on,
without asking anyone for access. That lowers the integration cost from "write a
parser + a selector deriver + a refresh job" to "one query".

> Numbers above are from the research pass against the live registry; the README
> links the exact index files and a runnable query so judges can verify counts.
