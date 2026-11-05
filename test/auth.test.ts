import { describe, it, expect } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { openDb } from '../src/db.js';
import { descriptorHash } from '../src/hash.js';
import type { Config } from '../src/config.js';
import {
  verifyWrite,
  AuthError,
  domain,
  types,
  type DescriptorWriteMessage,
} from '../src/auth.js';

// viem well-known test private key (Anvil account #0) — throwaway, never a real key.
const TEST_PK =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const account = privateKeyToAccount(TEST_PK);
const SIGNER_LOWER = account.address.toLowerCase();

const descriptor = {
  context: { contract: { chainId: 1, address: '0xabc' } },
  metadata: { owner: 'Example' },
};

function cfg(wallets: string[]): Config {
  return {
    arkiv: { privateKey: '', rpcUrl: '', wsUrl: '', chainId: 7794095 },
    github: {
      token: '',
      botLogin: '',
      upstreamOwner: '',
      upstreamRepo: '',
      webhookSecret: '',
    },
    authorizedWallets: new Set(wallets.map((w) => w.toLowerCase())),
    pollIntervalMs: 60000,
    dbPath: ':memory:',
    port: 3000,
  } as Config;
}

function futureDeadline(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + 3600);
}

async function signedRequest(
  msg: DescriptorWriteMessage
): Promise<{ descriptor: object; message: DescriptorWriteMessage; signature: `0x${string}` }> {
  const signature = await account.signTypedData({
    domain,
    types,
    primaryType: 'DescriptorWrite',
    message: msg,
  });
  return { descriptor, message: msg, signature };
}

describe('verifyWrite', () => {
  it('(a) valid allowlisted signature returns signer + action', async () => {
    const db = openDb(':memory:');
    const config = cfg([SIGNER_LOWER]);
    const msg: DescriptorWriteMessage = {
      descriptorHash: descriptorHash(descriptor),
      deadline: futureDeadline(),
      nonce: 1n,
      action: 'create',
    };
    const req = await signedRequest(msg);
    const result = await verifyWrite(req, db, config);
    expect(result.signer).toBe(SIGNER_LOWER);
    expect(result.action).toBe('create');
  });

  it('(b) tampered descriptor byte throws HASH_MISMATCH', async () => {
    const db = openDb(':memory:');
    const config = cfg([SIGNER_LOWER]);
    const msg: DescriptorWriteMessage = {
      descriptorHash: descriptorHash(descriptor),
      deadline: futureDeadline(),
      nonce: 2n,
      action: 'update',
    };
    const req = await signedRequest(msg);
    // tamper one byte of the descriptor AFTER signing over the original hash
    const tampered = {
      ...req,
      descriptor: { ...descriptor, metadata: { owner: 'Exampls' } },
    };
    await expect(verifyWrite(tampered, db, config)).rejects.toMatchObject({
      code: 'HASH_MISMATCH',
    });
    await expect(verifyWrite(tampered, db, config)).rejects.toBeInstanceOf(
      AuthError
    );
  });

  it('(c) past deadline throws EXPIRED', async () => {
    const db = openDb(':memory:');
    const config = cfg([SIGNER_LOWER]);
    const msg: DescriptorWriteMessage = {
      descriptorHash: descriptorHash(descriptor),
      deadline: BigInt(Math.floor(Date.now() / 1000) - 10),
      nonce: 3n,
      action: 'create',
    };
    const req = await signedRequest(msg);
    await expect(verifyWrite(req, db, config)).rejects.toMatchObject({
      code: 'EXPIRED',
    });
  });

  it('(d) signer not in allowlist throws UNAUTHORIZED', async () => {
    const db = openDb(':memory:');
    const config = cfg([]); // empty allowlist
    const msg: DescriptorWriteMessage = {
      descriptorHash: descriptorHash(descriptor),
      deadline: futureDeadline(),
      nonce: 4n,
      action: 'delete',
    };
    const req = await signedRequest(msg);
    await expect(verifyWrite(req, db, config)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('(e) reusing a consumed nonce throws REPLAY', async () => {
    const db = openDb(':memory:');
    const config = cfg([SIGNER_LOWER]);
    const msg: DescriptorWriteMessage = {
      descriptorHash: descriptorHash(descriptor),
      deadline: futureDeadline(),
      nonce: 5n,
      action: 'create',
    };
    const req = await signedRequest(msg);
    await verifyWrite(req, db, config); // consumes nonce 5
    await expect(verifyWrite(req, db, config)).rejects.toMatchObject({
      code: 'REPLAY',
    });
  });

  it('a FAILED check does NOT burn the nonce (replay guard runs last)', async () => {
    const db = openDb(':memory:');
    const nonce = 42n;
    // First: unauthorized attempt with nonce 42 (signer not allowlisted).
    const unauthConfig = cfg([]);
    const msg: DescriptorWriteMessage = {
      descriptorHash: descriptorHash(descriptor),
      deadline: futureDeadline(),
      nonce,
      action: 'create',
    };
    const req = await signedRequest(msg);
    await expect(verifyWrite(req, db, unauthConfig)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    // nonce 42 must still be unused for this signer
    expect(db.isNonceUsed(SIGNER_LOWER, '42')).toBe(false);
    // Now a VALID attempt with the SAME nonce 42 must succeed.
    const okConfig = cfg([SIGNER_LOWER]);
    const result = await verifyWrite(req, db, okConfig);
    expect(result.signer).toBe(SIGNER_LOWER);
    expect(result.action).toBe('create');
  });
});
