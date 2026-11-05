# Data quality

> Is the data up to date, and how does your import keep it that way? Can people
> filter it the way they actually search for it?

## Faithfulness to source

- Data is a **verbatim mirror** of the CC0 ERC-7730 registry
  (`ethereum/clear-signing-erc7730-registry`). The full `format` block per
  function is stored untouched in the entity payload — no re-modeling, no lossy
  transform. If Ledger adds a new field or format type, it flows through.
- The only *derived* data is convenience, not reinterpretation: the 4-byte
  `selector` (`keccak256(canonicalSig)[0:4]`) and the per-deployment flattening —
  both deterministic from the source.
- `contentHash` (RFC 8785 canonical keccak256) on every entity lets anyone verify a
  mirrored entity matches a source descriptor byte-for-byte.

## How the import stays current

- **Automatic two-way sync.** GitHub → Arkiv runs continuously: poll
  `compareCommitsWithBasehead(lastSyncedSha...master)` on a timer (default), with
  an optional HMAC-verified webhook `push`/`pull_request merged` fast-path. Both
  share one "apply changed files" path.
- **Latency:** a merge to the Ledger registry appears in Arkiv within one poll
  interval (default 60–120 s), or near-instantly via webhook.
- **Idempotent upserts:** deterministic entity keys (`NO_SALT` +
  `predictEntityKey`) mean a re-sync patches the existing entity rather than
  duplicating. Byte-identical files are skipped via the content-hash guard, which
  also prevents sync loops.
- **Lifetime:** every sync pass that touches an entity re-extends its expiration,
  so actively-mirrored data never lapses. A descriptor removed upstream is
  deleted (or allowed to expire).
- **Freshness is checkable:** `lastSyncedSha` is exposed; judges can compare it to
  the Ledger repo's current `master` HEAD.

## Can people filter it the way they search?

Yes — the indexed attributes are exactly the lookup keys developers use:

| They want… | They filter on |
|---|---|
| "the format for this exact call" | `chainId` + `contract` + `selector` |
| "everything this contract does" | `chainId` + `contract` |
| "all of Aave's descriptors" | `entityName = aave` |
| "every Supply action" | `intent = Supply` |
| "this function across protocols" | `functionName = transfer` |
| "calldata vs typed-message" | `kind` |
| "who authorized this entry" | `authorizedBy` |

The heavy `fields[]`/`format` body lives in the payload (returned, not filtered
on) — you filter by the small keys, then render the payload. One query, no
client-side post-filtering.

## Verification for judges

The README includes:
- the wallet address(es) that wrote the entities,
- one runnable query (SDK + JSON-RPC forms),
- the re-runnable import script, and
- a link to the CC0 license on the source repo.
