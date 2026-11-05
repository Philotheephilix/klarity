# Why Arkiv

> If this data sat in Postgres or any other database instead of Arkiv, what could
> people no longer do? What can people do with your copy on Arkiv that they can't
> do with the original GitHub source today?

## Vs. the original GitHub source

The source is a Git repo of JSON files. Today, to use it you must:

1. Clone / fetch the repo (or hit the GitHub contents API, rate-limited).
2. Parse a directory tree of descriptor files.
3. **Derive 4-byte selectors yourself** (`keccak256(canonicalSig)[0:4]`, after
   stripping parameter names) — the registry doesn't store them.
4. Flatten one file's many deployments into per-chain/per-contract rows.
5. Re-run all of that on every update.

With the Arkiv copy, a developer runs **one query** by `chain + address +
selector` and gets the exact format block. Selectors are pre-derived, deployments
pre-flattened, and the data is indexed on the fields people actually search by.
The integration cost drops from "build a pipeline" to "make a request".

## Vs. the same data in Postgres

If this lived in a Postgres instance instead of Arkiv, people could **no longer**:

- **Query it without asking us for access.** A Postgres box has an owner, a
  connection string, credentials, an allowlist. Arkiv is permissionlessly
  readable by anyone, anywhere — no account, no key handed out, no us in the loop.
- **Verify provenance.** On Arkiv every entity has an on-chain `creator`/`owner`.
  Readers filter `.createdBy(REGISTRY_WALLET)` and *know* the row came from the
  official mirror and nobody else — the write is cryptographically attributable.
  A Postgres row is whatever the DB admin says it is; you trust the operator.
- **Rely on tamper-evidence.** These entities can only be mutated by the owning
  service wallet. A silent edit by a third party is impossible on-chain; in
  Postgres any write credential can rewrite history invisibly.
- **Compose with other on-chain datasets natively.** Other Arkiv builders can
  join this mirror against their own entities (token lists, address labels) in the
  same query layer, by the same keys — no ETL between silos.
- **Trust liveness without trusting us.** `permissionlessExtension` lets *anyone*
  keep the dataset alive by extending entity lifetimes, even if our service goes
  down. A Postgres box dies with its operator's bill.
- **Audit the authorization.** The gated write path records `authorizedBy` (the EF
  wallet that signed the change) *on the entity*. The authority behind every
  change is queryable, on-chain, not a line in our app logs.

## The one-sentence version

Postgres gives you the data if you trust the operator and they grant you access;
Arkiv gives everyone the data permissionlessly, with cryptographic proof of who
put it there and the guarantee that nobody else can quietly change it.
