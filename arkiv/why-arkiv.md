# Why Arkiv

> The judged question: *If this data sat in Postgres or any other database instead of Arkiv, what could people no longer do? What can people do with the Arkiv copy that they can't do with the original source today?*

This criterion has two halves, and they are genuinely different questions. The first — *vs. the GitHub source* — is about **availability and ergonomics**. The second — *vs. a Postgres box* — is about **trust and permissionlessness**. Clear-signing data needs all four, because it is consumed at transaction time by software defending a user's funds.

---

## Part A — vs. the original GitHub source: the availability argument

### Clear-signing data fails *downward*, not loudly

Most data tolerates a retry. Clear-signing data cannot, because its absence does not raise an error the user sees — it causes a **downgrade**. When a wallet cannot fetch the descriptor, it does not stop; it shows raw hex and asks the user to sign anyway. That is **blind signing**, the single largest vector for drained wallets, delivered at the exact instant an attacker's phishing calldata is in front of the user. The one safeguard engineered to catch the malicious transaction is removed precisely when it is needed.

So "is the source always reachable?" is not an ops nicety here. It is the security property.

### The source lives behind one host, and that host goes down

The registry is a GitHub repo. Wallets reach it over `raw.githubusercontent.com` and the GitHub API — the two surfaces a descriptor fetch hits. From GitHub's **own public status history** (`githubstatus.com/history`), a recent two-week window shows this is routine, not rare:

- **Nov 3, 2026** — Git Operations degraded for **~7.5 hours** (15:00–22:37 UTC).
- **Nov 4, 2026** — Pull Requests, Git Operations, Issues, API Requests and Actions degraded (~2 hours, 09:49–11:50 UTC).
- **Oct 27, 2026** — elevated 404s for GitHub App tokens across **Git Operations and API Requests** (06:55–08:01 UTC).
- **Oct 26, 2026** — API Requests, Pull Requests, Actions and Issues degraded (17:59–18:40 UTC).
- **Nov 3, 2026** — API, Git and Copilot requests degraded (13:25–13:56 UTC).
- **Nov 5–6, 2026** — multi-service degradation touching Git Operations, API Requests, Issues, Actions and Pages.

That is multiple incidents touching **Git Operations and/or API Requests in two weeks** — the exact surfaces a descriptor lookup depends on. (We cite GitHub's own incident log and do not claim a cumulative annual downtime figure, because we could not verify one.)

ERC-7730's own security section names this class of risk directly, listing **"front-end/CDN compromise"** and **"registry poisoning"** among the threats a clear-signing pipeline must survive. A single centralized host is both the availability single-point-of-failure *and* the poisoning target.

### What the Arkiv copy lets people do that the GitHub source does not

- **Fetch a descriptor without depending on GitHub's uptime.** The lookup runs against a decentralized substrate with no single host to take down, rate-limit, or return a 404 at the worst moment.
- **Query by identity instead of cloning and parsing.** One request by `(chainId, contract, selector)` returns the exact format block. Selectors are **pre-derived** (`keccak256(canonicalSig)[0:4]`, which the registry does not store — consumers derive it themselves today), deployments are **pre-flattened** per chain and contract, and the data is indexed on the fields people actually search by. Integration cost drops from "write a parser + a selector deriver + a refresh job" to "make a query."
- **Resolve a descriptor that is already self-contained.** Klarity merges every `includes` fragment and inlines every `$ref` before storage (`arkiv/schema.md`), so a consumer needs no second lookup and no fragment resolver — the GitHub source hands you partial files that you must complete yourself.

---

## Part B — vs. the same data in Postgres: the trust argument

Suppose we skipped Arkiv and served the identical, pre-flattened data from a Postgres instance with a REST API. Availability-wise that is better than one GitHub repo. But people could **no longer**:

- **Query it without asking us for access.** A Postgres box has an owner, a connection string, credentials, an allowlist, and a bill. Arkiv is **permissionlessly readable over plain JSON-RPC** — no account, no key handed out, no us in the loop. "Anyone can query it without asking" is the literal premise of this bounty, and Postgres cannot give it.
- **Verify provenance cryptographically.** On Arkiv every entity carries an on-chain `creator`/`owner`. Readers pin `.createdBy(REGISTRY_WALLET)` (enforced inside `ArkivClient` on every read) and *know* the row came from the official mirror and nothing else — forged entities written under the same schema namespace by any other key are never returned. A Postgres row is whatever the DB admin says it is; you trust the operator's word.
- **Rely on tamper-evidence.** These entities can only be mutated by the owning service wallet, which signs every transaction. A silent third-party edit is impossible on-chain. In Postgres, any write credential rewrites history invisibly and leaves no public trace — the worst possible property for a *security* dataset, where a quietly poisoned descriptor is an attack, not a bug.
- **Trust liveness without trusting us.** The entities are written with `permissionlessExtension: true` (`src/arkiv/client.ts`), so **anyone** can keep the dataset alive by extending entity lifetimes even if our service wallet goes idle — without being able to edit a single field. A Postgres box dies with its operator's bill. This is a property a conventional database structurally cannot offer: *decoupling who-keeps-it-alive from who-can-change-it.*
- **Compose natively with other on-chain datasets.** Other Arkiv builders join this mirror against their own entities (token lists, address labels) in the same query layer, by the same keys, with no ETL between silos.
- **Audit the authority behind every change.** The gated write path records `authorizedBy` (the EF wallet that signed the change) *on the entity itself* and distinguishes `source = github-sync` vs `authorized-write`. The authority behind every row is queryable and on-chain — not a line in our application logs that only we can see.

### The reputation layer only makes sense on a substrate like this

Availability gets you *a* descriptor; it does not tell you *which to trust*. ERC-7730 warns that a registry "MUST assume it will be targeted" and recommends "cryptographically verifiable provenance and attestations for each file" and "a public, tamper-evident history of submissions, approvals, and revocations." Klarity carries that as first-class data: an EF-gate attestation (`attestationUID`/`attester` columns bound to the row) and a public, **interaction-proven** vouch tier (`snap/src/ranking.ts` — a vouch is only attested after the voucher's own mined transaction to the contract is verified). Consumers can **rank** descriptors by verified reputation rather than trusting a flat list. That trust signal — publicly checkable, impossible to quietly rewrite, living next to the data — is exactly what a decentralized, attestable substrate provides and a private database cannot.

---

## The one-sentence version

GitHub gives you the data when its servers are up and you have finished parsing the repo; Postgres gives you the data if you trust the operator and they grant you access; **Arkiv gives everyone the data permissionlessly, always-on, with cryptographic proof of who put it there and a guarantee that nobody else can quietly change it** — which is the only acceptable set of properties for the data that stands between a user and a malicious signature.

---

## Sources (verified) and honesty note

- ERC-7730 standard — clear signing, "lower end-user risk from frontend and phishing attacks," and the security section naming "front-end/CDN compromise" and "registry poisoning": <https://eips.ethereum.org/EIPS/eip-7730> (verified).
- ERC-7730 clear-signing registry, CC0-1.0, CAIP-10 index lookup: <https://github.com/LedgerHQ/clear-signing-erc7730-registry> and the Ethereum-org mirror <https://github.com/ethereum/clear-signing-erc7730-registry> (verified).
- GitHub incident history (the dated Git Operations / API degradations above, including the ~7.5-hour Nov 3, 2026 Git Operations incident): <https://www.githubstatus.com/history> (verified against GitHub's own status feed).

**What we did not verify, and therefore do not claim:** a cumulative annual GitHub-downtime percentage (we cite only individual, dated incidents from GitHub's own log), and any specific wallet product's live consumption of the registry beyond the spec's vendor-neutral design and the registry's own documented consumption path.
