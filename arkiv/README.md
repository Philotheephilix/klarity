# Klarity on Arkiv — judge's index

Klarity mirrors the **ERC-7730 clear-signing registry** — the dataset that lets
wallets show *"Supply 1,000 USDC to Aave"* instead of raw hex, and whose absence
forces **blind signing** — into [Arkiv](https://arkiv.network) as queryable
on-chain entities keyed by `(chainId, contract, selector)`. The data that keeps
users from blind-signing their funds lives in one GitHub repo today; Klarity makes
it always-on, verifiable, and impossible to take down.

## The four judged criteria (25% each)

| Criterion | File | In one line |
|---|---|---|
| **Arkiv feedback** | [`friction.md`](friction.md) | Six repro-grade issues from the real build — the 180-day lifetime cap, `bytes` columns not being indexable, no native upsert — plus what worked. |
| **Reach** | [`reach.md`](reach.md) | A security-critical dataset (224 forks, ~740 descriptors → ~16.4k entities across ~16 chains) on the signing path of every ERC-7730 wallet; who queries the Arkiv copy after the event. |
| **Why Arkiv** | [`why-arkiv.md`](why-arkiv.md) | vs. GitHub: always-on at signing time (GitHub's own ~7.5-hr Git outage cited). vs. Postgres: permissionless reads, on-chain provenance, tamper-evidence, community-survivable liveness. |
| **Data quality** | [`data-quality.md`](data-quality.md) | Verbatim CC0 mirror with byte-level hash verification; 60-second poll + webhook keeps it fresh; filterable by every key developers actually search on. |

## Technical reference

- [`schema.md`](schema.md) — the `ClearSignDescriptor` entity, indexed attributes,
  ownership, deterministic upsert, and expiration. Authoritative definition lives
  in `src/arkiv/schema.ts`.

## Verify it yourself

The repo [`README`](../README.md) gives the service wallet address, one runnable
query (SDK + JSON-RPC), the re-runnable import (`npm run import`), the analysis
script that reproduces the counts (`scripts/analyze.mjs`), and the CC0 source link.
