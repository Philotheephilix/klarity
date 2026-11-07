# Data quality

> The judged question: *Is the data up to date, and how does the import keep it that way? Can people filter it the way they actually search for it?*

Two promises: the mirror is **faithful** (it is the real registry, verifiably, not a re-interpretation) and **fresh** (a merge upstream shows up here fast and automatically), and it is **filterable by the keys developers actually search on**.

---

## 1. Faithfulness — it is the real data, and you can prove it

- **Verbatim mirror of a CC0 source.** The full ERC-7730 `format` block for each function is stored **untouched** in the entity body (`src/arkiv/schema.ts` → `body` column, canonical UTF-8 JSON). No re-modeling, no lossy transform. If Ledger adds a new field or a new `format` type upstream, it flows through unchanged — validated against all current descriptors.
- **The only derived data is deterministic convenience, not reinterpretation:** the 4-byte `selector` (`keccak256(canonicalSig)[0:4]`) and the per-deployment flattening. Both are mechanical functions of the source, reproducible by anyone from the same file.
- **Self-contained before storage.** `includes` fragments are deep-merged and `$ref` definitions inlined (`arkiv/schema.md`), so a consumer gets a complete descriptor in one read — no dangling pointer, no second fetch.
- **Byte-level verifiability.** Every entity carries a canonical hash of its body (`bodyHash`, an RFC 8785 / canonical-JSON keccak256) and a `contentHash` of the whole source descriptor. Anyone can recompute the hash from the upstream file and confirm the mirrored entity matches **byte-for-byte**. Faithfulness is not a claim you take on faith; it is a hash you can check.

---

## 2. Freshness — how the import stays current, automatically

The mirror is kept live by a continuous GitHub → Arkiv sync (`src/sync.ts`), driven two ways that share **one** "apply changed files" path so they cannot diverge:

- **Polling (default).** On a timer (`POLL_INTERVAL_MS`, default **60 s** — `src/config.ts`), `runIngestOnce` reads the stored **sync cursor** (the last-synced upstream sha), fetches the current `master` head, and asks GitHub `compareCommitsWithBasehead(cursor...master)` for exactly the descriptor files that changed (`src/github.ts`, `changedDescriptors`). Only changed files are touched.
- **Webhook fast-path (optional).** A GitHub `push` / merged-PR webhook (`POST /webhooks/github`) drives the **same** ingest path for near-instant updates. The HMAC is verified over the exact raw bytes received (`src/routes/webhook.ts`); an unconfigured secret makes the route refuse with 503 rather than trust an unsigned call.

**Latency.** A merge to the registry appears in the Arkiv mirror within one poll interval (default ~60 s), or near-instantly when the webhook is configured.

**Idempotent, no duplicates, no sync loops.** Writes upsert by identity: the client looks the entity up by `(chainId, contract, selector)` pinned to the service wallet and `patchEntity`s it if present, else `createEntity`s with `NO_SALT` (`src/arkiv/client.ts`). A per-file content-hash **loop guard** skips byte-identical files without a write, and also prevents the service's own write-back PRs from being re-ingested.

**Never lapses while active.** Arkiv entities expire by design; every sync pass that touches an entity **re-extends** its lifetime (180 days per touch — see `friction.md` for why 180 and not 365), so actively-mirrored data never ages out. A descriptor removed upstream is explicitly deleted (`status === 'removed'` → delete the entities for that `sourcePath`) or allowed to expire. And because entities are written `permissionlessExtension: true`, the community can keep the mirror alive even if the service wallet goes idle.

**Freshness is checkable by a judge.** The sync cursor is the upstream sha the mirror last ingested; compare it to the registry's current `master` HEAD on GitHub and you can see exactly how current the copy is.

---

## 3. Filterability — people can query it the way they actually search

Every attribute a developer searches on is an **indexed** column, usable directly in a `.where(...)` filter (`src/arkiv/schema.ts`, `INDEXED_ATTRIBUTES`). The heavy `fields[]` / `format` body is in the non-indexed payload — returned and rendered, never filtered on — so you filter by small keys and get the body in the same response, no client-side post-filtering.

| What a developer wants | What they filter on |
|---|---|
| "the format for this exact call" | `chainId` + `contract` + `selector` |
| "everything this contract does" | `chainId` + `contract` |
| "all of Aave's descriptors" | `entityName = aave` |
| "every Supply action across protocols" | `intent = Supply` |
| "this function everywhere" | `functionName = transfer` |
| "a specific contract by name" | `contractName = WrappedTokenGatewayV3` |
| "calldata vs typed-message" | `kind = calldata` / `kind = eip712` |
| "a typed-message by its primary type" | `kind = eip712` + `eip712PrimaryType` |
| "who authored / owns this" | `owner` |
| "github-synced vs authorized-write" | `source` |
| "who authorized this entry" | `authorizedBy` |
| "is this EF-attested" | `attestationUID` / `attester` |

The headline lookup — `(chainId, contract, selector)` — is a single request returning the format block plus a `verified` trust block (`src/routes/query.ts`). The same filters are available over the Arkiv SDK, over plain JSON-RPC, and over the thin HTTP read API (`GET /descriptors/:chainId/:address/:selector`, `GET /descriptors/:chainId/:address`, `GET /descriptors?…`).

> Note on indexing reality: because the SDK cannot index a `bytes` column, `selector` is stored and indexed as the `0x…` hex **string** so the headline lookup actually filters on it. See `friction.md` item 2 — this is the one place "how we'd model it" bent to "what the SDK indexes," and we bent it so the data stays filterable the way people search.

---

## 4. Verification for judges

The README provides everything needed to check all of the above:
- the **service wallet address** that wrote every entity (reads pin `.createdBy` to it),
- **one runnable query** in both SDK and JSON-RPC form,
- the **re-runnable import** (`npm run import`) and the analysis script (`scripts/analyze.mjs`) that reproduces the counts,
- the **sync cursor** to compare against upstream `master`, and
- the **CC0 license** link on the source repo.
