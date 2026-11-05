# Klarity

Klarity mirrors the Ledger [ERC-7730 clear-signing registry](https://github.com/LedgerHQ/clear-signing-erc7730-registry)
into [Arkiv](https://arkiv.network) as queryable on-chain entities. It walks every
descriptor in the registry, resolves `includes` fragments and `$ref` pointers into
self-contained records, flattens each descriptor into one entity per
`(chainId, contract, selector)`, and upserts them onto the Rabdi testnet — then
keeps the mirror fresh with an incremental GitHub sync loop and serves the result
over a small read API. The payoff: a wallet can look up "what does this calldata /
EIP-712 payload mean" by `(chainId, contract, selector)` in a single Arkiv query
instead of cloning and parsing the whole registry.

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
`functionName`, `functionSignature`, `kind` (`calldata` | `eip712`), `intent`,
`entityName`, `contractName`, `owner`, `sourcePath`, `source`, `eip712PrimaryType`
(plus a non-indexed `contentHash` and `schemaVersion`). The headline lookup is by
`(chainId, contract, selector)` — `selector` is the 4-byte calldata selector (or
the EIP-712 primary-type typeHash prefix) as a `0x…` hex string.

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

## Upstream registry & license

Descriptors are sourced from the Ledger ERC-7730 registry:
<https://github.com/LedgerHQ/clear-signing-erc7730-registry>. That registry's
descriptor content is published under **CC0** (public domain dedication); Klarity
mirrors it verbatim (normalized into entities) and adds only provenance metadata.

## AI-usage disclosure

This backend was built with AI assistance.
