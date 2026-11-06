# Swarm Body Store — Design

**Date:** 2026-11-06
**Status:** awaiting approval

## Intent & why

Today Klarity mirrors the ERC-7730 registry into Arkiv as a flattened,
queryable index. The full descriptor body (`EntityRecord.formatBlock`) is
computed by the normalizer but **dropped at write time** — only the indexed
columns + a `contentHash` reach Arkiv. Arkiv's indexed `str` columns are
capped at 128 bytes, so large fields can't live there anyway.

This change adds a second storage tier: **ethswarm (Bee) holds the full
descriptor body; Arkiv holds the queryable index plus a Swarm reference to
the body.** A query hits Arkiv, gets a row that points at Swarm, and (for a
single-descriptor read) Klarity's own API dereferences the Swarm ref and
inlines the body before returning it. The caller never talks to Swarm.

Result: the raw ERC-7730 body becomes retrievable (not just the index), and
Arkiv rows stay small and uniform regardless of descriptor size.

## Goals

- Store the full `formatBlock` on Swarm on every write (create, update,
  backfill, sync).
- Add an indexed `swarmRef` column to the Arkiv schema; store the Bee
  reference there.
- Single-descriptor reads dereference Swarm and inline the body, after
  verifying the fetched bytes hash to the row's `contentHash`.
- Browse/list reads return rows (with `swarmRef`) and make **zero** Bee
  calls.
- Read-only operation (browse, identity lookup of the index) works with **no
  Bee node configured**.

## Non-goals

- No size-threshold branching. The trigger is **always to Swarm** — one write
  path, one read-dereference path. (Decision below.)
- No change to the EIP-712 signed-write security gate, the allowlist, the
  nonce replay set, or the fork-flow PR write-back.
- No migration tool for already-written rows. The existing live entities
  (written in prior sessions) predate `swarmRef`; they keep working for index
  queries and simply have no body to dereference until re-synced. A re-run of
  the backfill repopulates them (hash loop-guard will re-write since the
  schema changed).
- No pinning/stewardship management, no postage-batch purchase from Klarity.
  Operator funds and runs the Bee node per the Swarm docs.

## Anti-goals

- Browse must never fan out into N Bee fetches. If a future `?inline=` flag is
  added it stays opt-in and off by default — out of scope here.
- Klarity must not silently write a row with no retrievable body. If the
  Swarm upload fails, the whole upsert fails loud (no half-written index).

## Decisions made (my calls)

1. **Always to Swarm, no size branch.** User said "keep the arch simple and
   scalable." A size threshold means two write paths, two read paths, and a
   migration question. Always-Swarm makes Arkiv a pure index of refs + Bee the
   blob store: one code path, rows uniform forever. The 128-byte cap on the
   *indexed* columns still stands (selectors/names are short by nature), so it
   stops being a data-loss risk.
2. **Only the single-descriptor endpoint dereferences.** Browse returns refs.
   Keeps list queries at zero Bee cost.
3. **Verify `contentHash` on dereference.** After `GET /bytes/{ref}`,
   recompute `descriptorHash(body)` and compare to the row's stored
   `contentHash`; mismatch → 502/500, don't serve. Defense in depth even
   though Swarm is content-addressed.
4. **Bee at `http://localhost:1633`** (Bee default), postage batch discovered
   via `GET /stamps` at startup or set via `SWARM_POSTAGE_BATCH_ID`. The write
   path fails loud if no usable batch; the read path needs only `BEE_API_URL`.
5. **No live Swarm upload is run by the assistant on its own initiative** —
   `POST /bytes` spends a funded postage batch (real xBZZ on Gnosis). The
   live step waits for the operator to confirm a funded, synced node.

## The how

### New module: `src/swarm/client.ts`

```
class SwarmClient {
  constructor(config)                        // BEE_API_URL, postageBatchId
  async uploadBody(body: object): Promise<string>   // POST /bytes -> ref (64-hex)
  async fetchBody(ref: string): Promise<Record<string, unknown>>  // GET /bytes/{ref}
  async resolveBatchId(): Promise<string>    // GET /stamps -> first usable batch (if id unset)
  async health(): Promise<boolean>           // GET /health
}
```

- `uploadBody`: JSON.stringify → `POST /bytes` with
  `Content-Type: application/octet-stream` and header
  `swarm-postage-batch-id: <batch>`; parse `{ reference }` from the 201 body.
- `fetchBody`: `GET /bytes/{ref}`, read octet-stream, `JSON.parse`.
- Fail loud with a typed `SwarmError` on non-2xx / missing batch.

### Schema: `src/arkiv/schema.ts`

Add one column:
```
swarmRef: str().indexed(),   // 64-hex Bee reference to the full formatBlock
```
Add `'swarmRef'` to `INDEXED_ATTRIBUTES`. `toValues` writes
`swarmRef: str(meta.swarmRef)` — so `WriteMeta` gains a required
`swarmRef: string`. `formatBlock` still never becomes an Arkiv column; it goes
to Swarm instead.

### Writer: `src/arkiv/client.ts`

`ArkivClient.upsert` does **not** call Swarm itself (keeps it a pure Arkiv
client). Instead the callers (write route, importer, sync writer) upload the
body first and pass the ref in `WriteMeta.swarmRef`. Rationale: one place owns
"body → Swarm → ref," and `ArkivClient` stays unit-testable without a Bee
node. A small shared helper `uploadAndMeta(swarm, rec, baseMeta)` lives in the
writer-side glue.

### Read: `src/routes/query.ts`

- `GET /descriptors/:chainId/:address/:selector` — after `queryOne`, if the
  row has `swarmRef`, `swarm.fetchBody(ref)`, verify
  `descriptorHash(body) === row.contentHash` (unwrap the row's wrapped
  values), attach `body` as `row.formatBlock`, return. On fetch/verify failure
  → 502 `bad gateway` (Swarm unavailable or tampered).
- `GET /descriptors/:chainId/:address` and `GET /descriptors` — unchanged,
  return rows (with `swarmRef`) as-is. No Bee calls.

### Importer & sync: `src/import.ts`, `src/sync.ts`

Both upload `rec.formatBlock` to Swarm and thread `swarmRef` into the
`upsert` meta. Importer `ImportDeps` gains `swarm: Pick<SwarmClient,
'uploadBody'>`. The oversized-field guard
(`recordExceedsStringCap`) stays for the *indexed* columns but no longer
touches the body (which is now unbounded on Swarm).

### Config: `src/config.ts`

```
swarm: {
  apiUrl: env.BEE_API_URL ?? 'http://localhost:1633',
  postageBatchId: env.SWARM_POSTAGE_BATCH_ID ?? '',
}
```
Neither in REQUIRED — read-only index operation needs no Bee. The write/import
path validates `postageBatchId` (or resolves one via `/stamps`) and fails loud
if absent.

### Server wiring: `src/server.ts`

Construct a `SwarmClient` in `main()`, thread it into `ServerDeps` so the
query route and write route can reach it.

## What's left to the builder

- Exact Bee request/response plumbing (header names confirmed against the
  Bee 8.2.1 OpenAPI: `POST /bytes` → `ReferenceResponse { reference }`;
  `swarm-postage-batch-id` header).
- Error-to-HTTP mapping details for the new 502 path.
- Whether sync's include-deferred files need any body handling (they're
  skipped today; stays the same).

## Review focus (inputs the tasks must pin)

- Bee node down / unreachable on a single-descriptor read → 502, not a hang or
  500 with a stack. (Timeout on the fetch.)
- Write path with no postage batch configured and none discoverable → fail
  loud before any Arkiv write, so no index row without a body.
- `contentHash` mismatch between Swarm body and Arkiv row → refuse to serve.
- A row written before `swarmRef` existed (no ref) read via single-descriptor
  endpoint → return the index row without a body (don't 502), since there's
  nothing to dereference.
- Oversized **indexed** field still dropped by the existing guard — the body
  being on Swarm doesn't change the indexed-column cap.
