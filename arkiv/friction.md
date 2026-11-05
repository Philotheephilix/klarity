# Arkiv feedback — friction

> What should we improve to make Arkiv better: something that got in the way, or
> something missing that would make building easier? When something broke: what
> we expected, what happened, how to reproduce.

> This file is filled in **during the build** against the live Rabdi testnet.
> Below is the structure plus the first observations from the research pass; each
> entry gets concrete repro steps as we hit them.

## What got in the way

### 1. API-reference index is stale / incomplete
- **Expected:** the TypeScript SDK API reference to list the current testnet
  chain helper (`rabdi`).
- **Happened:** the API-reference index page lists `localhost` / `tiramisu` but
  **not `rabdi`**; `rabdi({ accessKey })` is only confirmed on the start-here and
  Rabdi pages. A newcomer following the API reference alone would not find it.
- **Repro:** open the TS SDK API reference chains section vs. the Rabdi page —
  they disagree.
- **Fix suggestion:** regenerate the API-reference chains index from the same
  source as the network pages.

### 2. Expiration is mandatory but "permanent" guidance is thin
- Every `createEntity` requires an `expiration`. For a **registry mirror** we
  want effectively-permanent data, but the rent model means we must re-extend on
  each sync. A documented "recommended pattern for long-lived reference data"
  (and whether a true `permanent()` exists / its cost) would save guesswork.

### 3. (placeholders — filled with live repros during build)
- Access-key rate-limit behavior under a bulk backfill (hundreds of writes).
- Query pagination ergonomics for a full-registry scan.
- Whether `NO_SALT` + `predictEntityKey` upsert behaves as documented at scale.

## What would make building easier (missing)
- An **upsert** primitive (create-or-patch by deterministic key) — we build it
  by hand with `predictEntityKey` + existence check; a first-class helper would
  remove a race and a round-trip.
- A **batch write** API for backfills (hundreds of entities in one pass).
- A typed **read helper** that filters `.createdBy` by default for "trusted
  namespace" reads — the docs warn you must do this, but it's easy to forget.

## What worked well
- `defineSchema` with `.indexed()` is a clean mental model for "queryable columns
  vs payload body".
- The query builder (`select().where().createdBy().fetch()`) maps directly onto
  the lookup we need.
- Deterministic keys via `NO_SALT` make idempotent sync tractable.
