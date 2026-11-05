import { recoverTypedDataAddress } from 'viem';
import { descriptorHash } from './hash.js';
import type { Db } from './db.js';
import type { Config } from './config.js';

/**
 * Distinct failure modes of a signed-write verification. Each `code` maps 1:1
 * to an HTTP status in the API layer (T9), so callers can respond precisely:
 *   HASH_MISMATCH -> 422 (body does not match signed hash)
 *   EXPIRED       -> 401/403 (deadline passed)
 *   UNAUTHORIZED  -> 403 (signer not on the Ethereum-Foundation allowlist)
 *   REPLAY        -> 409 (nonce already consumed)
 */
export type AuthErrorCode =
  | 'HASH_MISMATCH'
  | 'EXPIRED'
  | 'UNAUTHORIZED'
  | 'REPLAY';

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

export type WriteAction = 'create' | 'update' | 'delete';

/**
 * The EIP-712 message object a client signs to authorize a registry write.
 * `descriptorHash` binds the signature to exact descriptor bytes; `deadline`
 * and `nonce` are uint256 seconds / counter (bigint in viem); `action` is the
 * intended mutation.
 */
export interface DescriptorWriteMessage {
  descriptorHash: `0x${string}`;
  deadline: bigint;
  nonce: bigint;
  action: WriteAction;
}

/**
 * EIP-712 domain for the Klarity clear-signing registry. Fixed, global
 * constraint — every authorized signature is bound to exactly these values.
 * No `verifyingContract`: writes are authorized off-chain, not by a contract.
 */
export const domain = {
  name: 'Klarity ClearSign Registry',
  version: '1',
  chainId: 7794095,
} as const;

/**
 * EIP-712 struct types. Deliberately omits the `EIP712Domain` entry — viem
 * derives that from `domain`. `action` is a plain string in the type system;
 * only the four known values are accepted downstream.
 */
export const types = {
  DescriptorWrite: [
    { name: 'descriptorHash', type: 'bytes32' },
    { name: 'deadline', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'action', type: 'string' },
  ],
} as const;

export interface VerifyWriteRequest {
  descriptor: object;
  message: DescriptorWriteMessage;
  signature: `0x${string}`;
}

/**
 * Verify a signed registry-write request. THE security gate of the system:
 * only an allowlisted wallet presenting a valid EIP-712 signature over the
 * exact descriptor bytes, within deadline, with a fresh nonce, may proceed.
 *
 * Checks run fail-fast in this order, each its own AuthError code:
 *   1. HASH_MISMATCH — recomputed descriptorHash != signed message.descriptorHash
 *   2. EXPIRED       — now (unix seconds) > deadline
 *   3. UNAUTHORIZED  — recovered signer (lowercased) not in allowlist
 *   4. REPLAY        — nonce already consumed (checked + consumed LAST)
 *
 * The replay guard is LAST and is the ONLY place the nonce is consumed, so a
 * request that fails any earlier check never burns the nonce — an attacker
 * cannot grief a legitimate (signer, nonce) pair with forged/expired requests.
 */
export async function verifyWrite(
  req: VerifyWriteRequest,
  db: Db,
  config: Config
): Promise<{ signer: string; action: WriteAction }> {
  const { descriptor, message, signature } = req;

  // 1. Content binding: the body must hash to exactly what was signed.
  const computed = descriptorHash(descriptor);
  if (computed !== message.descriptorHash) {
    throw new AuthError(
      'HASH_MISMATCH',
      'descriptor hash does not match signed message'
    );
  }

  // 2. Freshness: deadline is unix SECONDS; compare against now in seconds.
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  if (nowSeconds > message.deadline) {
    throw new AuthError('EXPIRED', 'signature deadline has passed');
  }

  // 3. Authorization: recover signer from the signature, lowercase, allowlist.
  const recovered = await recoverTypedDataAddress({
    domain,
    types,
    primaryType: 'DescriptorWrite',
    message,
    signature,
  });
  const signerLower = recovered.toLowerCase();
  if (!config.authorizedWallets.has(signerLower)) {
    throw new AuthError('UNAUTHORIZED', 'signer is not an authorized wallet');
  }

  // 4. Replay guard LAST: atomic check-and-set. markNonceUsed returns false if
  // the (signer, nonce) pair was already consumed. Only a fully-valid request
  // reaches here, so only a fully-valid request consumes a nonce.
  const fresh = db.markNonceUsed(signerLower, message.nonce.toString());
  if (!fresh) {
    throw new AuthError('REPLAY', 'nonce has already been used');
  }

  return { signer: signerLower, action: message.action };
}
