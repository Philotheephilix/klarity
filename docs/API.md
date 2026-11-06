# Klarity HTTP API

Klarity mirrors the [ERC-7730 clear-signing registry](https://github.com/LedgerHQ/clear-signing-erc7730-registry)
into [Arkiv](https://arkiv.network) (Rabdi testnet, chainId `7794095`) as queryable
entities, and exposes a small HTTP API over them.

- **Base URL (local):** `http://127.0.0.1:3000`
- **Content type:** all responses are `application/json`.
- **Read routes** are unauthenticated and served from Arkiv (pinned to the service
  wallet, so impostor entities are never returned).
- **Write route** requires an EIP-712 signature from an EF-allowlisted wallet.
- **Webhook route** requires a valid GitHub `X-Hub-Signature-256` HMAC.

Every Arkiv column is stored as a `{ type, value }` envelope and `u64` reads back
as a BigInt. The read routes **unwrap** these into plain JSON before responding:
`chainId` is a number, string columns are plain strings, and the internal
`body` / `bodyHash` columns never appear in a response (the decoded, hash-verified
descriptor is surfaced as `formatBlock` on the single-descriptor route instead).

---

## Read routes

### `GET /descriptors/:chainId/:address/:selector`

One descriptor by its full identity `(chainId, contract, selector)`. This is the
only route that decodes and inlines the descriptor body.

**Path params**

| Param | Notes |
|---|---|
| `chainId` | Numeric. Non-numeric → `400`. |
| `address` | Contract address. Case-insensitive (lower-cased server-side). |
| `selector` | 4-byte function selector, e.g. `0x04f04769`. |

**Responses**

- `200` — the descriptor. If a body column is present, it is hex-decoded, parsed,
  **hash-verified** against the stored `bodyHash`, and inlined as `formatBlock`.
- `404` — `{ "error": "Not Found", "message": "descriptor not found" }`.
- `400` — non-numeric `chainId`.
- `500` — `body decode failed` (body not valid UTF-8 JSON) or `body hash mismatch`
  (stored body does not match its integrity hash).

**Example**

```bash
curl 'http://127.0.0.1:3000/descriptors/1/0xa1ea2f8c0518458975e09ed63bf5d48980f76c38/0x04f04769'
```

```json
{
  "$key": "0x40a19145864dab7a93de89c8c7566232e1e5a0daacc87c4c151a2e3d5494363b",
  "chainId": 1,
  "contract": "0xA1EA2F8C0518458975E09ED63bf5D48980f76C38",
  "selector": "0x04f04769",
  "functionName": "open",
  "kind": "calldata",
  "intent": "Open Shield Vault holding",
  "entityName": "10102",
  "contractName": "ShieldVault",
  "owner": "10102",
  "sourcePath": "registry/10102/calldata-ShieldVault.json",
  "source": "github-sync",
  "contentHash": "0x0000…0000",
  "schemaVersion": "../../specs/erc7730-v2.schema.json",
  "formatBlock": {
    "$id": "open",
    "intent": "Open Shield Vault holding",
    "fields": [
      { "format": "tokenAmount", "label": "Amount", "params": { "tokenPath": "token" }, "path": "amount" },
      { "format": "duration", "label": "Withdrawals wait", "path": "config.exitDelay" }
    ]
  }
}
```

> Pre-body rows (written before the body-store feature) return `200` with the row
> columns but no `formatBlock`.

---

### `GET /descriptors/:chainId/:address`

All formats for a contract `(chainId, contract)`.

**Responses**

- `200` — a JSON array of descriptor rows. `body` / `bodyHash` are stripped and
  `formatBlock` is **not** inlined on this route (use the single-descriptor route
  for bodies).
- `400` — non-numeric `chainId`.

**Example**

```bash
curl 'http://127.0.0.1:3000/descriptors/1/0xa1ea2f8c0518458975e09ed63bf5d48980f76c38'
```

---

### `GET /descriptors`

Filtered browse. At least one known filter is required.

**Query params (indexed filter keys)**

`chainId`, `contract`, `selector`, `kind`, `intent`, `entityName`, `contractName`,
`functionName`, `owner`, `sourcePath`, `source`, `eip712PrimaryType`.

- `chainId` is coerced to a number; non-numeric → `400`.
- `contract` is lower-cased.
- Unknown query params (e.g. `functionSignature`, `bogus`) are **ignored**.

**Responses**

- `200` — a JSON array of matching rows (`body` / `bodyHash` stripped).
- `400` — no known filter supplied (empty query, or only unknown keys).

**Example**

```bash
curl 'http://127.0.0.1:3000/descriptors?entityName=10102'
curl 'http://127.0.0.1:3000/descriptors?chainId=1&kind=calldata'
```

---

### `GET /nonce/:address`

Returns a fresh candidate nonce for a signer to use in a signed write. This is a
**suggestion, not a reservation** — the write route's replay guard is the real
protection. The value is derived from the current time and walked forward past any
already-consumed nonce for the signer.

**Responses**

- `200` — `{ "nonce": "<decimal string>" }`.

**Example**

```bash
curl 'http://127.0.0.1:3000/nonce/0x9236c57baeb306d5f4bb9e6e2a5f15b74c1af305'
# {"nonce":"1793955061051"}
```

---

## Decode route

### `POST /decode`

"What am I signing?" A wallet posts the call it is about to sign — either raw
`calldata` or an EIP-712 `typedData` payload — and gets back a human-readable
account of what it means, drawn from the mirrored ERC-7730 descriptor: the
intent, the interpolated-intent sentence, and every labeled field with its
format and visibility.

> **Labels, not values.** Klarity does not store parameter ABI types, so this
> route names *what each field means* (and whether the wallet should show it)
> but does **not** ABI-decode concrete argument values out of the calldata. The
> raw input is echoed back under `raw` so the caller still has it.

**Request body — one of two input modes**

Calldata mode:

```jsonc
{
  "chainId": 1,
  "contract": "0xd01607c3c5ecaba394d8be377a08590149325722",
  "calldata": "0x474cf53d…"   // 0x + 4-byte selector + args
}
```

EIP-712 mode — the selector is reconstructed from the typed-data types
(`keccak256(encodeType(primaryType))[:4]`, matching how the mirror keys eip712
descriptors). An explicit `selector` may be supplied as an override:

```jsonc
{
  "chainId": 1,
  "contract": "0x119c71d3bbac22029622cbaec24854d3d32d2828",
  "typedData": {
    "primaryType": "Order",
    "types": { "Order": [ { "name": "maker", "type": "address" }, … ] },
    "message": { /* … */ }
  },
  "selector": "0x7b63e942"      // optional override
}
```

**Responses**

- `200` — the signing breakdown (shape below).
- `400` — non-numeric `chainId`; malformed `contract`; `calldata` shorter than a
  4-byte selector; neither `calldata` nor `typedData` supplied; or `typedData`
  without a resolvable `primaryType`/`types` (and no explicit `selector`).
- `404` — no mirrored descriptor for the derived `(chainId, contract, selector)`.
- `500` — the stored descriptor body failed to decode or its integrity hash
  did not match.

**Response shape**

```jsonc
{
  "signing": {
    "chainId": 1,
    "contract": "0xd01607c3c5ecaba394d8be377a08590149325722",
    "selector": "0x474cf53d",
    "kind": "calldata",             // "calldata" | "eip712"
    "decodedFrom": "calldata",
    "contractName": "WrappedTokenGatewayV3",
    "functionName": "depositETH",
    "intent": "Supply",
    "interpolatedIntent": null,      // the "{placeholder}" sentence, if any
    "summary": "Supply"             // interpolatedIntent || intent || functionName
  },
  "fields": [                        // visible fields the wallet should show
    { "label": "Amount to supply", "path": "@.value", "format": "amount", "hidden": false },
    { "label": "Collateral recipient", "path": "onBehalfOf", "format": "addressName", "hidden": false, "params": { … } }
  ],
  "hiddenFields": [                  // descriptor's visible:"never" fields
    { "label": "Referral Code", "path": "referralCode", "hidden": true }
  ],
  "note": "Labels and intent come from the ERC-7730 descriptor. Argument values are not ABI-decoded.",
  "raw": { "calldata": "0x474cf53d…" }
}
```

> A pre-body row (written before the body-store feature) still returns a `200`
> with the `signing` summary from the indexed columns, but `fields` is empty —
> field labels live only in the stored body.

**Examples**

```bash
# Calldata — Aave WrappedTokenGatewayV3.depositETH:
curl -X POST http://127.0.0.1:3000/decode -H 'Content-Type: application/json' -d '{
  "chainId": 1,
  "contract": "0xd01607c3c5ecaba394d8be377a08590149325722",
  "calldata": "0x474cf53d0000000000000000000000000000000000000000000000000000000000000001"
}'

# EIP-712 — 1inch limit order (selector reconstructed from types):
curl -X POST http://127.0.0.1:3000/decode -H 'Content-Type: application/json' -d '{
  "chainId": 1,
  "contract": "0x119c71d3bbac22029622cbaec24854d3d32d2828",
  "typedData": { "primaryType": "Order", "types": { "Order": [ … ] } }
}'
```

---

## Write route

### `POST /descriptors`

The authoritative signed-write route. **Only** an EF-allowlisted wallet with a valid
EIP-712 signature may mutate a mirrored entity and open an upstream GitHub PR.

**Request body**

```jsonc
{
  "descriptor": { /* a resolved ERC-7730 descriptor (no unresolved includes) */ },
  "message": {
    "descriptorHash": "0x…",       // must match keccak hash of `descriptor`
    "deadline": "1793955061051",   // unix seconds, numeric or decimal string
    "nonce": "1",                  // numeric or decimal string
    "action": "create"            // "create" | "update" | "delete"
  },
  "signature": "0x…",              // EIP-712 signature over `message`
  "path": "registry/…json",        // optional: registry path to write under
  "entityKey": "0x…"               // optional: explicit key (delete only)
}
```

**Behavior**

- `create` / `update`: normalize the descriptor → upsert each emitted record to
  Arkiv → open **one** PR. Returns `{ entityKey, txHash, prUrl }`.
- `delete`: resolve the entity key (from `entityKey`, or by identity lookup) →
  remove from Arkiv → open a PR. Returns `{ txHash, prUrl }`.

**Responses**

| Status | Meaning |
|---|---|
| `200` | Write applied; PR opened. |
| `400` | Invalid body/message shape, non-numeric deadline/nonce, unknown `action`, hash mismatch, descriptor yields no records, or an includes-bearing (unresolved) descriptor. |
| `401` | `{ "error": "UNAUTHORIZED" }` — signer not allowlisted / bad signature. |
| `404` | `delete` of a descriptor that isn't mirrored. |

> The route is the parser boundary: it validates body shape and coerces
> `deadline`/`nonce` to BigInt **before** signature verification, and checks the
> recovered `action` against the known union **after**. Descriptors must be posted
> already-resolved — the write path has no synchronous registry reader for includes.

---

## Webhook route

### `POST /webhooks/github`

GitHub push webhook. Drives the same ingest path as the background poll loop.

- Verifies `X-Hub-Signature-256` (HMAC-SHA256 over the raw body, timing-safe).
- De-duplicates on `X-GitHub-Delivery`; a replayed id is an acknowledged no-op.
- Runs the sync path for each changed descriptor file in the push.

**Responses**

| Status | Meaning |
|---|---|
| `202` | `{ "accepted": <n> }` — delivery processed; `n` changed descriptor files. |
| `200` | `{ "status": "duplicate" }` — replayed delivery id. |
| `401` | `{ "error": "invalid signature" }` — missing/invalid HMAC. |
| `503` | `{ "error": "webhook secret not configured" }` — `GITHUB_WEBHOOK_SECRET` unset. |

---

## Running the server

The production entrypoint (`src/server.ts` `main()`) reads config via `loadConfig()`,
which requires `GITHUB_TOKEN`, and listens on `config.port` (default `3000`). It
injects a real Arkiv client, a GitHub client, and a SQLite `db`.

Relevant environment variables:

| Variable | Purpose |
|---|---|
| `ARKIV_PRIVATE_KEY` | Service wallet key (writes). |
| `ARKIV_RPC_URL` | Arkiv JSON-RPC HTTP endpoint (Rabdi). |
| `ARKIV_WS_URL` | Arkiv WebSocket endpoint. |
| `ARKIV_CHAIN_ID` | `7794095` (Rabdi). |
| `ARKIV_ACCESS_KEY` | Optional. Absent → public, heavily rate-limited endpoint. |
| `GITHUB_TOKEN` | Required by `loadConfig()`. |
| `GITHUB_WEBHOOK_SECRET` | Required for the webhook route (else `503`). |
| `REGISTRY_ROOT` | Local registry clone the backfill/sync walks. |
