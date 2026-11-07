# Arkiv Schema — Klarity Clear-Signing Registry

> Required by the prize rules: the entities, the fields we query, who owns them,
> and when they expire.

## Schema namespace

`clear-signing-erc7730` — defined with the SDK's `defineSchema`. All registry
entities share this namespace. **Readers MUST filter `.createdBy(REGISTRY_WALLET)`**
so entities forged under the same namespace by other wallets are ignored (per
Arkiv docs' own warning).

## The entity: `ClearSignDescriptor`

One ERC-7730 descriptor file declares many deployments and many functions. We
**flatten** it: one entity per `(chainId, contractAddress, functionSignature)`.
That is exactly the granularity a developer looks up, so lookup is a single
direct query with no post-filtering. Partial descriptors are completed first:
any `includes` fragment is deep-merged in **before** flattening, so inherited
formats (e.g. EIP-2612 permit) become real entities.

### Two entity kinds, one shape

- **`kind = "calldata"`** — keyed by the 4-byte `selector`
  (`keccak256(canonicalSig)[0:4]`). This is the headline lookup.
- **`kind = "eip712"`** — typed-message descriptors have **no** 4-byte selector.
  They are keyed by **`eip712PrimaryType`**. For these entities:
  - `selector` = the first 4 bytes of the EIP-712 `typeHash` of the primary type
    (a stable, derivable identifier — lets the `selector` column stay non-null and
    uniform), with the full `encodeTypeHashes[]` kept in the payload.
  - `functionName` / `functionSignature` = the primaryType string (+ domain).
  Developers querying typed-message descriptors filter on
  `kind = "eip712"` + `chainId` + `contract` (+ `eip712PrimaryType`).

### Attributes (indexed = queryable columns)

> Indexing note: the installed SDK cannot index a `bytes` column
> (`IndexableValue = Exclude<ArkivValue, BytesValue>`). So `selector` is stored as
> an indexed **`str`** holding its `0x…` hex (queryable), and `contentHash` is a
> non-indexed, read-back-only `bytes` blob. There is **no** `functionSignature`
> column — the canonical signature lives inside the stored body. See
> `src/arkiv/schema.ts` for the authoritative definition and `friction.md` item 2.

| Attribute | Type | Indexed | Meaning |
|---|---|---|---|
| `chainId` | `u64` | ✅ | EVM chain of the contract (1, 10, 8453, 42161, …) |
| `contract` | `addr` | ✅ | Contract address, lowercased |
| `selector` | `str` | ✅ | 4-byte selector `keccak256(canonicalSig)[0:4]` as `0x…` hex (calldata) |
| `functionName` | `str` | ✅ opt | Canonical name, e.g. `depositETH` (omitted if over the 128-byte str cap) |
| `kind` | `str` | ✅ | `calldata` or `eip712` |
| `intent` | `str` | ✅ | Human action, e.g. `Supply`, `Repay loan` |
| `entityName` | `str` | ✅ | Submitting org / registry dir, e.g. `aave` |
| `contractName` | `str` | ✅ | e.g. `WrappedTokenGatewayV3` |
| `owner` | `str` | ✅ | Descriptor `metadata.owner`, e.g. `Aave DAO` |
| `sourcePath` | `str` | ✅ | `registry/aave/calldata-WrappedTokenGatewayV3.json` |
| `authorizedBy` | `addr` | ✅ opt | EF wallet that authorized the write (provenance) |
| `source` | `str` | ✅ | `github-sync` or `authorized-write` |
| `eip712PrimaryType` | `str` | ✅ opt | EIP-712 primary type (eip712 kind only) |
| `attestationUID` | `str` | ✅ opt | EAS EF-gate attestation UID bound to this row (`0x…64hex`) |
| `attester` | `addr` | ✅ opt | On-chain attester that produced the attestation |
| `contentHash` | `bytes` | — | canonical **keccak256** of the full descriptor (loop guard; the EIP-712 signature binds to it) |
| `body` | `bytes` | — | the full canonical ERC-7730 `format` block, stored verbatim as UTF-8 JSON |
| `bodyHash` | `str` | — | canonical keccak256 of `body` (integrity check) |
| `schemaVersion` | `str` | — | `$schema` version the descriptor targets |

### Payload (the body, not indexed)

The **full ERC-7730 `format` block for this function** — `intent`, `$id`, and
the complete `fields[]` array (`path`, `format`, `label`, `params`, `visible`) —
stored verbatim as JSON. For eip712 entities, the typed-data `domain` and
`encodeTypeHashes[]`. Retrieved with `entity.toJson()`.

The payload is made **self-contained** before storage:
- **`includes` resolved:** any `includes` fragment (`ercs/*` or `common-*`) is
  deep-merged in, so partial descriptors become complete.
- **`$ref` definitions inlined:** fields that reference
  `$.display.definitions.X` have the definition's keys inlined (field's own keys
  win on conflict), so no `$ref` dangles and the consumer needs no second lookup.

> We store the format block **verbatim** (after include + `$ref` resolution) —
> no re-modeling. If Ledger adds a new `format` type, it flows through untouched.
> Fields a developer filters on are indexed attributes; the thing they render is
> the payload. Validated against all 740 current descriptors: every one resolves
> to a complete, self-contained payload.

## Deterministic keys (upsert by identity)

Entity key is derived with `NO_SALT` + `predictEntityKey` from the identity
`(chainId, contract, selector)` for calldata and
`(chainId, contract, eip712PrimaryType)` for eip712. The sync computes the key,
checks existence, then **patches or creates** — no duplicates across re-syncs.
An authorized `delete` removes the entity by this same key and opens a source-file
removal PR.

## Ownership

- **On-chain owner & creator:** the Klarity **service wallet** (it submits every
  tx). No other wallet can patch/delete/transfer these entities → tamper-evident.
- **Authorization provenance:** `authorizedBy` attribute records the EF wallet
  that signed the REST request (for `authorized-write` entities); `source`
  distinguishes GitHub-synced vs authorized-write.
- **Trust filter for readers:** always `.createdBy(<REGISTRY_WALLET>)`.

## Expiration

`createEntity` requires an expiration. Registry entries are long-lived:

- Per entity `ExpirationTime.fromDays(180)` — the longest practical lifetime under
  the Rabdi engine's `MAX_LIFETIME` cap (~182 days). A nominal 365-day lifetime is
  refused on-chain (see `friction.md` item 1).
- Every sync pass that touches an entity **re-extends** it, so actively-mirrored
  data never lapses. Stale entries (descriptor deleted upstream) are allowed to
  expire, or explicitly `deleteEntity`'d when a `removed` file is seen.

## Flags

- `readonly`: **not** set — the sync must `patchEntity` when upstream changes.
- `permissionlessExtension`: **set `true`** — so anyone can keep an entry alive
  (extend its lifetime) without being able to edit it. Lets the community help
  the mirror survive even if the service wallet is idle.

## The queries developers actually run

**One-request lookup (the headline):**
```ts
const { entities } = await client
  .select({ attributes: true, payload: true })
  .where(
    eq("chainId", u64(1n)),
    eq("contract", addr("0xd01607c3c5ecaba394d8be377a08590149325722")),
    eq("selector", str("0x474cf53d")),
  )
  .createdBy(REGISTRY_WALLET)
  .fetch()
const format = entities[0]?.toJson()   // ERC-7730 format block
```

**All formats for a contract:**
```ts
.where(eq("chainId", u64(1n)), eq("contract", addr("0xd016…")))
```

**Browse by protocol / intent / function name:**
```ts
.where(eq("entityName", "aave"), eq("intent", "Supply"))
.where(eq("functionName", "transfer"))
```

**Equivalent JSON-RPC (no SDK):**
```json
{ "jsonrpc":"2.0","id":1,"method":"arkiv_query",
  "params":[ "arkiv.schema = str('clear-signing-erc7730') AND chainId = u64(1) AND selector = str('0x474cf53d')",
             { "select": { "attributes": true, "payload": true }, "limit": "0xa" } ] }
```

## Field ownership & lifecycle summary

| Field group | Written by | Changes when |
|---|---|---|
| lookup keys (`chainId`,`contract`,`selector`) | normalizer | never (identity) |
| format payload | sync / authorized-write | upstream descriptor changes |
| `contentHash` | sync | descriptor content changes |
| `authorizedBy`,`source` | writeApi | on an authorized write |
| `expiresAt` | every sync pass | re-extended on each touch |
