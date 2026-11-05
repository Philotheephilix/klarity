# Wallet-Signature-Gated Authorization (research)

Backend accepts an ERC-7730 descriptor + wallet signature. Only EF-allowlisted
wallets may write. Service verifies signer → writes Arkiv entity → opens GitHub PR.

## 1. EIP-191 vs EIP-712 — use EIP-712

- **EIP-191 `personal_sign`** signs an opaque UTF-8 string. Wallets show the raw
  blob; users can't see what they approve; structure must be re-parsed and
  re-canonicalized server-side (fragile).
- **EIP-712 typed data** signs a *structured, domain-separated* message. Wallets
  render named fields, the domain binds the signature to this service + chain
  (anti-cross-replay), and hashing is deterministic (`\x19\x01 ‖ domainSeparator
  ‖ hashStruct(message)`). **Recommended.**

### Typed-data design: "authorize descriptor write"

```ts
const domain = {
  name: 'Klarity ClearSign Registry',
  version: '1',
  chainId: 7794095n,                 // Arkiv Rabdi — binds to this network
  // optional: verifyingContract if a registry contract exists later
} as const

const types = {
  DescriptorWrite: [
    { name: 'chainId',         type: 'uint256' }, // target chain of the CONTRACT described
    { name: 'contractAddress', type: 'address' },
    { name: 'descriptorHash',  type: 'bytes32' }, // keccak256 of canonical JSON (see §5)
    { name: 'action',          type: 'string'  }, // "create" | "update" | "delete"
    { name: 'nonce',           type: 'uint256' },
    { name: 'deadline',        type: 'uint256' }, // unix seconds
  ],
} as const
```

Note two distinct chainIds: `domain.chainId` = the *network the signature is
valid on* (Rabdi); `message.chainId` = the chain the *described contract* lives
on (e.g. 1 for mainnet). Keep them separate to avoid confusion.

## 2. Server-side verification (viem)

```ts
import { verifyTypedData, recoverTypedDataAddress } from 'viem'

// message = the exact struct the client signed
const signer = await recoverTypedDataAddress({
  domain, types, primaryType: 'DescriptorWrite', message, signature,
})
// recoverTypedDataAddress returns Address; verifyTypedData returns boolean.

if (!ALLOWLIST.has(signer.toLowerCase())) throw new Error('unauthorized signer')

// Equivalent boolean form if you already expect a specific address:
const ok = await verifyTypedData({
  address: expected, domain, types,
  primaryType: 'DescriptorWrite', message, signature,
})
```

`recoverTypedDataAddress` is the right primitive here — recover first, then test
membership against the allowlist (no "expected address" to pass up front).

## 3. Replay protection — nonce + deadline

- **deadline**: reject if `now > message.deadline`. Keep windows short (e.g. 5
  min) so a captured signature expires fast.
- **nonce**: per-signer monotonic counter OR random 32-byte value recorded as
  used. Store `(signer, nonce)` in a `used_nonces` table/KV; reject on re-seen.
  Monotonic (`require(nonce == nextNonce[signer]++)`) is simplest and also
  prevents out-of-order writes. Expose `GET /nonce/:address` so clients fetch
  the next nonce before signing.
- Combine with **descriptorHash**: even within the window a signature only
  authorizes *that exact* descriptor + action.

## 4. The allowlist

- **Phase 1 (recommended): config file / env var.** `AUTHORIZED_WALLETS` =
  comma-separated checksummed addresses, loaded into a lowercased `Set`.
  Simplest robust option; rotation = redeploy/reload config. Good enough for a
  hackathon + EF-controlled set.
- **Future: on-chain registry** (an `AuthorizedSigners` contract EF controls) —
  read membership via `publicClient.readContract`. Enables rotation without
  redeploy and makes the authority auditable on-chain. Document as v2.
- **Relationship to Arkiv ownership:** the Arkiv entity is owned by the wallet
  that *writes* it (the service's own Arkiv wallet, since the service submits the
  tx). The *REST signer* (EF-authorized) is the authorization layer; the *Arkiv
  writer* is the service wallet. These can differ — record the REST signer inside
  the entity's attributes (e.g. `authorizedBy`) so provenance is queryable even
  though on-chain ownership is the service wallet. If you want the signer to also
  own the entity, the signer must submit the Arkiv tx themselves (direct-write
  mode) — a tradeoff to note in the design.

## 5. Binding signature to exact content

Hash the **canonical JSON** of the descriptor and sign that hash:

```ts
import { keccak256, toHex } from 'viem'
import canonicalize from 'canonicalize' // RFC 8785 JCS

const canonical = canonicalize(descriptorObj)!      // deterministic key order
const descriptorHash = keccak256(toHex(canonical))  // bytes32
```

Server recomputes `descriptorHash` from the received body and checks it equals
`message.descriptorHash` **before** recovering the signer. This makes the
payload immutable: swapping the JSON invalidates the signature.

## 6. Security pitfalls

- **Canonical serialization**: client and server MUST canonicalize identically
  (RFC 8785 / JCS). Any whitespace/key-order drift breaks the hash. Pin one lib
  (`canonicalize`) on both sides; never hash `JSON.stringify` output naively.
- **Signature malleability**: viem's recover/verify handle 65-byte sigs; prefer
  recovering the address over comparing raw sig bytes. Don't dedupe by signature
  string — dedupe by `(signer, nonce)`.
- **Cross-service replay / domain separation**: unique `domain.name` +
  `version` + `chainId` ensures a signature for another dapp can't be replayed
  here. Never reuse a generic domain.
- **Checksum vs lowercase**: normalize addresses (`.toLowerCase()`) on both the
  allowlist and recovered signer before comparison.
- **TOCTOU on nonce**: record the nonce as used in the *same* transaction/row
  insert that accepts the write (unique constraint on `(signer, nonce)`), not in
  a separate check-then-write.
