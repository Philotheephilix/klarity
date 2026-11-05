# ERC-7730 Clear-Signing Registry — Research

Source: https://github.com/ethereum/clear-signing-erc7730-registry (maintained by Ledger). Spec: https://clearsigning.org, EIP-7730.

## 1. Repo layout

```
index.calldata.json        # auto-generated index: "eip155:<chainId>:<address>" -> file path
index.eip712.json          # auto-generated index: key -> { <PrimaryType>: [{path, encodeTypeHashes[]}] }
specs/
  erc-7730.md
  erc7730-v2.schema.json   # latest (v1 legacy, -next draft, -rc.N also appear); synced weekly from upstream
  erc7730-tests-v2.schema.json
ercs/                      # shared descriptor fragments (e.g. eip712-erc2612-permit.json) pulled via "includes"
registry/
  <entity_name>/                       # submitting org, e.g. aave, 1inch, lido, safe
    calldata-<ContractName>[-vX].json   # calldata (function-call) descriptor
    eip712-<MessageName>.json           # EIP-712 typed-message descriptor
    common-<shared>.json                # shared defs referenced by "includes"
    tests/ testsv2/                     # per-entity test vectors
```

- **84 entities** in `registry/` (aave, 1inch, lido, morpho, safe, cow-protocol, ens, okx, paraswap, lifi, …).
- One descriptor file can declare **many deployments** (one contract across many chains) — see `context.contract.deployments[]`.
- File naming carries the contract version (e.g. `calldata-AggregationRouterV6.json`, `calldata-Safe-1.5.0.json`).

## 2. Descriptor schema (v2) — top-level keys

- `$schema` — points at `specs/erc7730-v2.schema.json`.
- `includes` *(optional)* — path to a shared fragment under `ercs/` or a sibling `common-*.json`. Descriptors can be partial and inherit.
- `context` — identifies the target:
  - **calldata**: `context.contract.deployments[] = [{chainId, address}, ...]` (+ optional `abi`).
  - **eip712**: `context.eip712.deployments[]` + `context.eip712.domain {name, version}`.
- `metadata` — `{ owner, info: {url, deploymentDate, legalName?}, contractName }`.
- `display.formats` — the clear-signing intent. Keyed by **full function signature string**.

### Full calldata example — `registry/aave/calldata-WrappedTokenGatewayV3.json`
```json
{
  "$schema": "../../specs/erc7730-v2.schema.json",
  "context": {
    "$id": "WrappedTokenGatewayV3",
    "contract": {
      "deployments": [
        { "chainId": 1, "address": "0xd01607c3C5eCABa394D8be377a08590149325722" },
        { "chainId": 10, "address": "0x5f2508cAE9923b02316254026CD43d7902866725" },
        { "chainId": 8453, "address": "0xa0d9C1E9E48Ca30c8d8C3B5D69FF5dc1f6DFfC24" },
        { "chainId": 42161, "address": "0x5283BEcEd7ADF6D003225C13896E536f2D4264FF" }
      ]
    }
  },
  "metadata": {
    "owner": "Aave DAO",
    "info": { "url": "https://aave.com", "deploymentDate": "2025-02-11T01:19:11Z" },
    "contractName": "WrappedTokenGatewayV3"
  },
  "display": {
    "formats": {
      "depositETH(address pool, address onBehalfOf, uint16 referralCode)": {
        "$id": "depositETH",
        "intent": "Supply",
        "fields": [
          { "path": "@.value", "format": "amount", "label": "Amount to supply" },
          { "path": "onBehalfOf", "format": "addressName", "label": "Collateral recipient",
            "params": { "types": ["eoa"], "sources": ["local", "ens"] }, "visible": "always" },
          { "label": "Referral Code", "path": "referralCode", "visible": "never" },
          { "label": "Pool", "path": "pool", "visible": "never" }
        ]
      },
      "repayETH(address pool, uint256 amount, address onBehalfOf)": {
        "$id": "repayETH",
        "intent": "Repay loan",
        "fields": [
          { "path": "amount", "format": "tokenAmount", "label": "Amount to repay",
            "params": { "token": "0x00..00", "threshold": "0xFF..FE", "message": "All" }, "visible": "always" },
          { "path": "onBehalfOf", "format": "addressName", "label": "For debt holder",
            "params": { "types": ["eoa"], "sources": ["local", "ens"] }, "visible": "always" }
        ]
      }
    }
  }
}
```

### Full EIP-712 example — `registry/permit/eip712-permit-arbitrum-dai.json`
```json
{
  "$schema": "../../specs/erc7730-v2.schema.json",
  "includes": "../../ercs/eip712-erc2612-permit.json",
  "context": {
    "eip712": {
      "deployments": [{ "chainId": 42161, "address": "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1" }],
      "domain": { "name": "Dai Stablecoin", "version": "2" }
    }
  },
  "metadata": { "owner": "Dai Stablecoin" }
}
```

### A `format` entry
Each `display.formats[<signature>]` has:
- `$id` — short id,
- `intent` — the human-readable action ("Supply", "Repay loan", "Withdraw"),
- `fields[]` — each: `path` (ABI param name, or `@.value`/`@.from`/`@.to` for tx-level fields), `format` (`amount`, `tokenAmount`, `addressName`, `raw`, `date`, …), `label`, optional `params`, `visible` (`always`/`never`).

## 3. Function selectors / 4-byte hashes

- **Calldata descriptors key formats by the full function signature string**, e.g. `"depositETH(address pool, address onBehalfOf, uint16 referralCode)"`. Note param names are included — strip them to get the canonical `depositETH(address,address,uint16)` before computing the **4-byte selector = `keccak256(canonicalSig)[0:4]`**. The selector is NOT stored in the file; it must be derived.
- **EIP-712**: `index.eip712.json` stores `encodeTypeHashes[]` (32-byte typeHashes) per primary type — the typed-data analogue of a selector.

## 4. License — republishing OK

`LICENSE.md` = **Creative Commons CC0 1.0 Universal** (public-domain dedication). Explicitly permits copying, modification, and redistribution with no attribution requirement. Safe to republish; link it in README.

## 5. Scale & chains

- ~84 submitting entities; **hundreds** of calldata+eip712 descriptors; a single file fans out to many deployments.
- Chains seen in `index.calldata.json` (CAIP-2 `eip155:<id>`): 1 (mainnet), 10 (Optimism), 100 (Gnosis), 137 (Polygon), 146 (Sonic), 1030, 1088 (Metis), 8453 (Base), 42161 (Arbitrum), 43114 (Avalanche), 59144 (Linea), 534352 (Scroll), 1868, 9745, + testnets (1001, 10143, 102030). Broad EVM coverage.

## 6. PR / CI conventions

Contributions = PR adding/editing files under `registry/<entity>/`. CI workflows (`.github/workflows/`):
- `descriptor-lint.yml`, `format.yml` — schema + formatting lint.
- `descriptor-tests.yml`, `descriptor-test-results.yml`, `testsv2` — run test vectors against descriptors.
- `registry-checks.yml` — registry integrity.
- **`sync-indexes.yml`** — regenerates `index.calldata.json` / `index.eip712.json` from the descriptor files. **Do NOT hand-edit index files in a PR**; add the descriptor and let CI (or the repo's tooling) rebuild the index.
- `sync-specs.yml` — pulls latest schema weekly. `ai-review.yml`, `triage-red-prs.yml`, `pr-labels.yml` — review/triage automation.
- Tooling lives in `tools/` (+ `package.json`).

## Fields that matter for the query path (chain + address + selector → format)

To let a dev query **by chain + contract address + function selector** and get the clear-signing format, the mirror should key/index on:

1. **`chainId`** (int) and **`address`** (lowercased hex) — from each entry in `context.contract.deployments[]` (or `context.eip712.deployments[]`). The registry's own key format is `eip155:<chainId>:<address>` — reuse it.
2. **`functionSignature`** (the `display.formats` key) **and derived `selector`** (`keccak256(canonicalSig)[0:4]`, 0x-prefixed 8 hex). Compute and store both so devs can look up by either.
3. The **format payload**: `intent`, `fields[]` (path/format/label/params/visible), `$id`.
4. Provenance: `entity` (dir name), `contractName`, `owner`, `metadata.info.url`, source `filePath`, descriptor `version` (from filename), `$schema` version.
5. For EIP-712: `domain {name, version}` + `primaryType` + `encodeTypeHashes[]` instead of a 4-byte selector.

One descriptor → many (chainId, address) rows sharing the same formats block. Flatten on deployment for direct lookup.
