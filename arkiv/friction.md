# Arkiv feedback — friction

> The judged question: *What should Arkiv improve — something that got in our way, or something missing that would make building easier? When something broke, what did we expect, what happened, and how do you reproduce it?*

This is written from the actual build of Klarity against the live **Rabdi** testnet (`chainId 7794095`, `https://rpc.rabdi.db-chain.testnet.arkiv.network`). The friction below is not hypothetical — each item changed a line of our code, and we point at the file it changed. We like Arkiv; this is the feedback of someone who shipped on it, not someone who bounced off it.

---

## 1. `createEntity` lifetime is silently capped far below what the docs imply

**What we expected.** The schema design (`arkiv/schema.md`) called for long-lived reference data: `ExpirationTime.fromDays(365)`. The SDK accepts that value without complaint at the type level, so we wrote it.

**What happened.** The Rabdi engine **rejects** a single lifetime of 365 days on-chain. There is an undocumented `MAX_LIFETIME` of roughly **182 days**; a `createEntity` with `fromDays(365)` fails. We only learned the real ceiling by hitting it. Our fix (see `src/arkiv/client.ts`, `upsert`) is `ExpirationTime.fromDays(180)` plus a sync pass that re-extends on every touch:

```ts
// schema.md asks for 365d; Rabdi caps a single lifetime at ~182 days, so
// fromDays(365) is refused on-chain. Use the longest practical lifetime under
// the cap; the sync re-extends it.
expiration: ExpirationTime.fromDays(180),
```

**Repro.** `createEntity(schema, values, { expiration: ExpirationTime.fromDays(365), salt: NO_SALT })` against Rabdi → the write is refused. `fromDays(180)` succeeds.

**Fix suggestion.** Document `MAX_LIFETIME` on the Rabdi network page and in the `ExpirationTime` API reference, and make the SDK fail *early and loudly* (a client-side guard with the actual number) instead of letting the value through to an on-chain rejection. Even better: a first-class **`permanent()`** or an explicit "reference data" expiration tier, with its cost model documented, would remove the re-extension dance entirely for datasets like a registry mirror that are meant to never lapse.

---

## 2. `bytes` columns cannot be indexed — and the headline lookup is on a `bytes`-shaped value

**What we expected.** Our primary key is the 4-byte function `selector`. A `selector` is bytes, so `arkiv/schema.md` originally modelled it as an indexed `bytes` column and the headline query filtered `eq('selector', bytes('0x474cf53d'))`.

**What happened.** In the installed SDK, `bytes()` has no `.indexed()` method at all — `IndexableValue = Exclude<ArkivValue, BytesValue>`. A `bytes` column can be stored and read back but **never appear in a `.where(...)` filter.** The single most important query in the whole project — "give me the descriptor for this selector" — was un-expressible against a `bytes` column.

**Our workaround** (`src/arkiv/schema.ts`): store the selector as an **indexed `str`** holding its `0x…` hex string, and keep `contentHash`/`body` as the only (non-indexed, read-back-only) `bytes` columns:

```ts
// hex selector as an indexed str so the headline lookup can filter on it.
selector: str().indexed(),
...
// read-back only (loop guard); bytes is never indexable.
contentHash: bytes(),
```

**Fix suggestion.** This is the single biggest "gotcha" we hit. Either (a) support indexing on fixed-width `bytes` (a 4- or 32-byte selector/hash is a *natural* filter key for any EVM dataset), or (b) make the limitation impossible to miss — a prominent callout in the schema docs and a **compile-time** error when `.indexed()` is reached for on a bytes column, rather than the method simply being absent and the mistake surfacing as a confusing query that returns nothing.

---

## 3. There is no deterministic key *from your data*, so no native upsert

**What we expected.** From `predictEntityKey` + `NO_SALT` we expected to compute an entity's key directly from our identity tuple `(chainId, contract, selector)` and thereby upsert with a single call.

**What happened.** The key is derived from `(owner, nonce, salt)` — **not** from the record's attributes — so you cannot compute "the key for this descriptor" ahead of time. Our upsert is therefore a **query-then-branch**: look the entity up by its indexed identity, `patchEntity` if found, else `createEntity` (`src/arkiv/client.ts`, `upsert`). That is an extra round-trip and a race window on every write, hand-built per project.

**Fix suggestion.** A first-class **upsert-by-attribute-key** primitive (create-or-patch keyed on a declared unique attribute set) would remove the extra read and the race. This is the single most-requested database affordance for a mirror workload, and every team mirroring a dataset will re-implement it by hand exactly as we did.

---

## 4. No batch write for backfills — a one-shot import is N transactions

**What happened.** The backfill walks ~740 descriptor files and emits ~16.4k entities, each a separate signed transaction. With no batch-write API we built a hand-rolled concurrency pool of 8 in-flight writes (`src/import.ts`, `runPool`) purely to keep Rabdi write pressure bounded without a dependency.

**Fix suggestion.** A **batch/multicall write** (many `createEntity`/`patchEntity` in one submission) would make bulk mirroring dramatically faster and cheaper, and would let a backfill be atomic per batch. Bulk import is *the* workload for a "mirror public data" bounty; it deserves a first-class path.

---

## 5. Impostor-entity trust filter is load-bearing but easy to forget

**What happened.** Any wallet can write an entity under the same schema namespace (`clear-signing-erc7730`). The only thing stopping a reader from trusting a forged descriptor is remembering to pin `.createdBy(REGISTRY_WALLET)` on **every** read. We centralized it inside `ArkivClient` so no call site can forget — but the SDK itself offers no guard rail.

**Fix suggestion.** A typed **"trusted-writer" read helper** — a client bound to a creator address so every query is pinned by construction — would turn an easy-to-forget security footgun into the default. For a security-critical dataset this is the difference between safe-by-default and safe-if-you-remember.

---

## 6. The TypeScript API reference does not list the current testnet chain helper

**What we expected.** The TS SDK API-reference "chains" section to list `rabdi` alongside the other chain helpers.

**What happened.** The API-reference chains index lists `localhost` / `tiramisu` but **not `rabdi`**; `rabdi({ accessKey })` is only confirmed on the start-here and Rabdi network pages. A newcomer following the API reference alone would not find the chain they are told to use.

**Repro.** Open the TS SDK API-reference chains section and compare to the Rabdi network page — they disagree.

**Fix suggestion.** Regenerate the API-reference chains index from the same source as the network pages so the two cannot drift.

---

## What worked well (so this is feedback, not a complaint)

- **`defineSchema().indexed()`** is a genuinely clean mental model: "these columns are queryable, the rest is payload." It maps directly onto how a mirror wants to think.
- **The query builder** (`select().where().createdBy().fetch()`) reads almost exactly like the lookup we needed — once the `str`-selector adjustment was made, the headline query was a one-liner.
- **`permissionlessExtension: true`** is a quietly brilliant primitive: it let us make the mirror *community-survivable* (anyone can keep an entry alive without being able to edit it) with a single flag. Nothing in a conventional database offers this.
- **Permissionless reads over plain JSON-RPC** meant our HTTP API is a thin convenience over a substrate anyone can already query directly — exactly the property this bounty is about.

## Top three, if Arkiv fixes only three things

1. **Index fixed-width `bytes`** (or make the limitation a compile error) — item 2, the biggest trap.
2. **A native upsert-by-identity** — item 3, the thing every mirror re-implements.
3. **Document the lifetime cap and offer a reference-data expiration tier** — item 1, the surprise that reached on-chain.
