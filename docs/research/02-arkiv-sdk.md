# Arkiv TypeScript SDK — Research Findings

Package: `@arkiv-network/sdk` (+ `viem` peer). Node 22.10+ or Bun.
Testnet: **Rabdi** — chain id `7794095` (`0x76edaf`), RPC `https://rpc.rabdi.db-chain.testnet.arkiv.network`, WS `wss://rpc.rabdi.db-chain.testnet.arkiv.network`, gas token `tGLM`, block time 2s. Faucet + access keys at hub.arkiv.network. Explorer rabdi.explorer.arkiv.network.

---

## 1. Data model — what an Entity is

An entity is a schema-typed record on-chain. Fields returned by a query (`Entity` class):

| Field | Type | Meaning |
|---|---|---|
| `key` | `0x${string}` | entity key (identifier) |
| `owner` | `0x${string}` | current owner (changes on transfer) |
| `creator` | `0x${string}` | original creator (never changes) |
| `createdAt` | `bigint` | block created |
| `updatedAt` | `bigint` | block last patched |
| `expiresAt` | `bigint` | block it expires |
| `creationFlags` | `ResolvedCreationFlags` | immutable flags set at creation |
| `contentType` | `string` | MIME/content type of payload |
| `payload` | `Uint8Array` | raw payload bytes (≤128 KiB) |
| `attributes` | `Record<string, AnyArkivValue>` | typed, queryable attribute values |
| `attributeSchema` | record | attribute names+types, no values |

Methods: `entity.toJson()` (payload parsed as JSON), `entity.toText()` (payload as UTF-8).

**Payload vs attributes:** attributes are the indexed/queryable typed columns; the `payload` (bytes/JSON) carries the bulk body. For clear-signing: index the small lookup keys (chain id, contract address, selector) as attributes; put the full ERC-7730 JSON in the payload.

### Attribute types
`bool`, `i32`, `u64`, `u256`, `dec`, `bytes32`, `bytes`, `str`, `addr`, `key`.

### Schema definition (the `Posts` pattern)
```ts
import { addr, bytes, dec, defineSchema, str } from "@arkiv-network/sdk/schema"

const Posts = defineSchema("my-app.posts", {   // namespace string — MUST be globally unique
  author: addr().indexed(),       // .indexed() => filterable
  category: str().indexed(),
  score: dec().indexed(),
  title: str(),
  body: bytes(),
  summary: str().optional(),      // .optional() => omittable
})
```
`.indexed()` makes an attribute filterable in queries. `.optional()` allows omission. The schema namespace becomes a reserved `arkiv.schema` attribute you filter on.

---

## 2. Client setup
```ts
import { createPublicClient, createWalletClient } from "@arkiv-network/sdk"
import { rabdi } from "@arkiv-network/sdk/chains"
import { http, type Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"

const chain = rabdi({ accessKey: process.env.ARKIV_ACCESS_KEY ?? "" })  // "" => public rate-limited RPC + warning
const account = privateKeyToAccount(process.env.PRIVATE_KEY as Hex)
const publicClient = createPublicClient({ chain, transport: http() })   // reads
const walletClient = createWalletClient({ chain, transport: http(), account })  // writes
```
Access key from hub.arkiv.network/access-keys (public RPC heavily rate-limited). `rabdi` is the chain helper (docs API index is stale and lists only `localhost`/`tiramisu`, but `first-entity` + Rabdi pages confirm `rabdi({ accessKey })`).

---

## 3. Writing

### createEntity — returns `{ entityKey, txHash, expiresAt }`
```ts
import { ExpirationTime } from "@arkiv-network/sdk"
import { addr, dec } from "@arkiv-network/sdk/schema"
import { stringToBytes } from "viem"

const { entityKey, txHash, expiresAt } = await walletClient.createEntity(
  Posts,
  { author: addr(account.address), category: "news", score: dec("3.9"),
    title: "Arkiv ships schemas", body: stringToBytes("...") },
  { expiration: ExpirationTime.fromDays(30) },   // expiration REQUIRED
)
```
Value rules: required columns need values; `dec`/`addr`/`u256` must be wrapped (`dec("4.5")`, `addr(...)`) — a bare `5` throws `SchemaMismatchError` before sending. Payload bytes >128 KiB → `EntityTooLargeError`.

**Options (3rd arg):**
- `expiration` — REQUIRED (see §Expiration).
- `flags` — `{ readonly?, permissionlessExtension? }`, both off by default, immutable after creation.
  - `readonly`: attributes can never be patched; owner can still extend/handover/delete.
  - `permissionlessExtension`: **anyone** (not just owner) can extend lifetime — nobody else can edit. Read back via entity's `$creationFlags` / `creationFlags`.
- `salt` — key derives from `(owner, per-owner counter, salt)`; default 128 random bits. `salt: NO_SALT` (import `NO_SALT`) gives a **predictable/deterministic key** — use `predictEntityKey` to compute it ahead of time. (Useful: deterministic keys for upsert-by-identity.)

Optional 4th arg = tx fields: `gas`, `nonce`, `gasPrice` | `maxFeePerGas`/`maxPriorityFeePerGas`.

### patchEntity — OWNER ONLY
```ts
await walletClient.patchEntity(Posts, entityKey, { set: { score: dec("4.7"), summary: "..." } })
await walletClient.patchEntity(Posts, entityKey, { unset: ["summary"] })
```
Throws `EmptyPatchError` / `ConflictingMutationError`. `readonly` entities cannot be patched.

### changeOwnership — OWNER ONLY (transfer)
```ts
await walletClient.changeOwnership({ entityKey, newOwner: "0xd8dA..." })
```
Caller must be current owner; after transfer only new owner can modify. `$creator` stays unchanged.

### deleteEntity — OWNER ONLY
```ts
await walletClient.deleteEntity({ entityKey })   // gone as if expired
```

### extendEntity
Extends lifetime. Owner can always; if `permissionlessExtension` flag set, anyone can. (API alias `ExtendEntityParameters`; keeps entities alive without edit rights.)

Non-owner mutation / missing / expired → throws `EntityMutationError`.

---

## 4. Querying (THE critical part — lookup by chain+address+selector)

Builder off the public client: `client.select(...).where(...).ownedBy(...).limit(n).fetch()`.

```ts
import { eq, gte, or, and, startsWith } from "@arkiv-network/sdk/query"
import { i32 } from "@arkiv-network/sdk/attr"

const page = await client
  .select({ key: true, attributes: true })        // fields to return
  .where(gte("level", i32(10)), or(eq("status", "open"), eq("status", "review")))
  .ownedBy(owner)
  .limit(100)                                      // max 200
  .fetch()

for (const entity of page.entities) console.log(entity.key, entity.attributes)
await page.next()                                   // next page
```
Async-iterate all pages:
```ts
for await (const entity of client.select({ key: true }).where(eq("category", "docs"))) { ... }
```

**Operators** (`@arkiv-network/sdk/query`): `and`, `or`, `not`, `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `exists`, `startsWith`, `hasType`. Plus `render`, `runQuery`, `toRpcSelect`.

**Filter helpers:**
- `.ownedBy(addr)` = `where(eq("$owner", addr(owner)))`
- `.createdBy(addr)` = `where(eq("$creator", addr(creator)))` (creator stable, owner moves)
- Multiple `where` args AND together; repeated `.where()` calls all must hold.
- `.atBlock(1_297_000n)` read historical state; `.cursor(str)` resume; `.toString()` emits query string.

**Clear-signing lookup example** (what developers run):
```ts
const { entities } = await client
  .select({ key: true, attributes: true, payload: true })
  .where(eq("chainId", u64(1n)), eq("contract", addr("0xA0b8...")), eq("selector", bytes32("0x23b872dd")))
  .fetch()
const descriptor = entities[0]?.toJson()   // full ERC-7730 descriptor from payload
```

---

## 5. Ownership & permissions — how to gate writes to an allowlisted wallet

- Ownership = the wallet account on the `walletClient` that calls `createEntity`. That address becomes `owner` and `creator`.
- **Only the owner** can patch/delete/changeOwnership/extend (unless `permissionlessExtension`).
- To restrict writes to a single EF/authorized wallet: the service holds ONE wallet key (the authorized registry wallet). All `createEntity`/`patchEntity` calls go through it, so every registry entity is owned by that wallet. On-chain, no other wallet can mutate those entities. The service's REST layer verifies the submitter's signature against an allowlist BEFORE using its wallet to write — i.e. authorization is enforced at the service boundary, on-chain immutability is enforced by single-owner.
- Readers filter `.createdBy(REGISTRY_WALLET)` (or `.ownedBy`) to trust only official entries, defending against anyone writing arbitrary attributes under the same schema namespace (docs explicitly warn: filter on your project tag or `$owner`).

---

## 6. JSON-RPC API (alternative to SDK)

Standard Ethereum JSON-RPC + three `arkiv_*` methods. Access key appended to RPC URL.

**`arkiv_query`** — page of matching entities + count:
```json
{ "jsonrpc":"2.0","id":1,"method":"arkiv_query",
  "params":[ "arkiv.schema = str('my-app.posts') AND category = str('news')",
             { "select": { "key": true, "attributes": true }, "limit": "0xa" } ] }
```
Options: `select` (fields incl. `count`, scoped like `{"attributes":{"title":true}}`), `limit` (1–100, hex), `offset`. Response `result.data[]` entities with `attributes` as `[{name,type,value}]`, plus `blockNumber`, `count`.

**`arkiv_getEntity`** — one by key: `"params":["0x9f2c…"]` → entity or `null`.
**`arkiv_getBlockTiming`** — `{ current_block, current_block_time (unix s), duration }`.

**Query-string language:** `=` with typed literals `str('...')`, `u64(...)`, `addr(...)`, `key(0x..)`, combined with `AND`/`OR`. Pagination: `ORDER BY $key ASC` + `$key > key(0x…)`. Error codes: `-32001` parse, `-32002` type, `-32003` value, `-32004` node limit, `-32602` bad limit. Write/mutation methods are on a separate `/json-rpc/mutating-entities/` page (not fetched).

---

## 7. Making fields queryable / indexing
Mark attributes `.indexed()` in the schema → filterable via `where(...)`. Non-indexed attributes still returned but shouldn't be filtered on heavily. Keep the clear-signing lookup keys (`chainId`, `contract`, `selector`, maybe `functionName`) indexed; the big ERC-7730 JSON goes in `payload` (not indexed, fetched via `toJson()`).

## 8. Gas
Writes cost `tGLM` on Rabdi (test token, free from faucet). Reads are free (rate-limited without access key). Expiration is required because storage is rent-based — longer lifetime / larger payload costs more. `fromBlocks` is the exact native unit; duration helpers (`fromDays` etc.) convert to blocks.

---
### Gotchas for the build
- Expiration is mandatory on every create — pick a long/`permanent()` lifetime for registry entries, or re-extend on each sync.
- Schema namespace is a shared global — use something like `clear-signing-erc7730` and always filter `.createdBy(REGISTRY_WALLET)` so forged entries under the same namespace are ignored.
- Deterministic keys (`NO_SALT` + `predictEntityKey`) let the sync service upsert: compute key from identity, check if exists, patch vs create.
- API-reference index page is partially stale (missing `rabdi`, shows `tiramisu`); trust the start-here/Rabdi/writing pages.
