# @klarity/sdk

TypeScript SDK for the Klarity clear-signing registry: query ERC-7730 descriptors,
decode call data / EIP-712 typed data to a human-readable format block, and work
with the two-tier EAS attestation trust model.

## Install

```bash
npm install @klarity/sdk
```

Requires Node 18+ (ESM only — the package is `"type": "module"`).

## Query + decode — `KlarityClient`

A thin wrapper over the Klarity HTTP API. Inject your own `fetch` in tests; it
defaults to the global `fetch` otherwise.

```ts
import { KlarityClient } from '@klarity/sdk';

const klarity = new KlarityClient({ baseUrl: 'https://api.klarity.example' });

// One descriptor by (chainId, contract, selector).
const descriptor = await klarity.getDescriptor(1, '0xA1EA…', '0x04f04769');

// All formats for a contract.
const all = await klarity.listByContract(1, '0xA1EA…');

// Filtered browse (indexed keys only).
const page = await klarity.browse({ chainId: 1, owner: 'Aave' });

// Decode raw call data (or EIP-712 typed data) to a format block.
const decoded = await klarity.decode({ kind: 'calldata', chainId: 1, to: '0xA1EA…', data: '0x…' });
```

The single-descriptor response carries a `verified` block (see
[Trust model](#trust-model-two-tier)).

## Attestations — `KlarityAttester`

`KlarityAttester` both writes attestations (needs a signer) and verifies them
(needs only a candidate-attestation source).

> **This SDK never touches a private key.** Every write path takes a signer you
> construct and inject (`signerOrProvider`). The SDK neither reads a key file nor
> an environment variable. If you don't pass a signer, only the read/verify paths
> work; a write throws.

```ts
import { KlarityAttester, MAINNET } from '@klarity/sdk';
import { ethers } from 'ethers';

// You own the signer. The SDK only ever receives it already constructed.
const signer = new ethers.Wallet(process.env.MY_KEY!, provider); // your code, not the SDK's

const attester = new KlarityAttester({ profile: MAINNET, signerOrProvider: signer });

// Tier 1 — EF gate: attest a descriptor under the ERC-8176 `bytes32 descriptorHash` schema.
const uid = await attester.attestDescriptor(descriptor);

// Tier 2 — public vouch: attest that you interacted with the contract (proven by a tx hash).
const vouchUid = await attester.attestPublic(descriptor, {
  contract: '0xA1EA…',
  interactionTxHash: '0x…',
});
```

### Verifying

`verifyDescriptor` merges both tiers into a `VerifiedBlock`. It needs a
`readAttestations` candidate source (the EAS contract has no "query by
schema + data" read, so you inject one — an EAS indexer/GraphQL query, or the
UID stored on the Arkiv row) and a provider for the live interaction check.

```ts
const attester = new KlarityAttester({
  profile: MAINNET,
  readAttestations: async (schemaUID, descriptorHash) => {
    // Your indexer query returns candidate Attestation[] for this (schema, hash).
    return myIndexer.attestationsFor(schemaUID, descriptorHash);
  },
});

const verified = await attester.verifyDescriptor(descriptor, {
  trustedAttesters: [EF_WALLET_ADDRESS], // the gate: who counts as "the EF"
  provider, // ethers provider for the interaction-proof check
});
// → { efApproved, efAttester?, efAttestationUID?, publicVouches, rankedAttesters }
```

A public vouch counts **only** if its `interactionTxHash` resolves to a mined
transaction with `to == contract` and `from == attester` — so a vouch cannot be
forged by pointing at someone else's transaction.

## Trust model (two-tier)

- **Tier 1 — EF gate (`efApproved`).** A single EF-trusted wallet attests a
  descriptor under the canonical ERC-8176 schema (`bytes32 descriptorHash`). This
  is the gate: approved or not.
- **Tier 2 — public ranking (`publicVouches` / `rankedAttesters`).** Anyone may
  vouch under the extended schema (`bytes32 descriptorHash, address contract,
  uint256 chainId, bytes32 interactionTxHash`), but a vouch is counted only when
  its interaction transaction is verified on-chain. The count is a ranking
  signal, not a gate.

The Klarity HTTP `verified` block reports the EF tier from the stored attestation
columns (no live EAS read on a GET) and leaves the public tier empty; this SDK's
`verifyDescriptor` is the authoritative live public check.

## Mainnet subject, testnet EAS

The thing attested is the **descriptor hash** — a chain-agnostic digest of the
clear-signing format block (see `src/hash.ts`, the canonical implementation this
SDK re-exports). The EAS attestation itself can live on whatever chain the
`EasProfile` points at (`MAINNET`, `SEPOLIA`, `BASE_SEPOLIA`): the subject is the
same hash regardless of where the attestation is recorded. Pick the profile whose
`efSchemaUID`/`publicSchemaUID` are registered on the chain you attest on.

## Build & layout notes

`npm run build` runs `tsc`. Because `hash.ts` is re-exported from the server's
single canonical implementation (one source of truth, no duplicated hashing),
the emitted tree is nested: the package entry is `dist/sdk/src/index.js` and the
shared hash lands at `dist/src/hash.js`. `package.json` `exports`/`main`/`types`
point at these real paths and `files` ships the whole `dist/`, so the published
tarball is self-contained and `import '@klarity/sdk'` resolves correctly.

> Under raw `node` (not vitest), importing the attestation surface can surface an
> `lodash … isEqual` ESM export error — this originates in the `eas-sdk` dependency's
> own published dist and affects any consumer that pulls eas-sdk under a strict ESM
> loader, not Klarity code. Bundlers and vitest resolve it transparently.
