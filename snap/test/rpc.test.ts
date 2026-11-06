import { describe, it, expect } from 'vitest';
import type { Attestation } from '@ethereum-attestation-service/eas-sdk';
import { KlarityAttester } from '@klarity/sdk';
import { descriptorHash } from '@klarity/sdk';
import { MAINNET } from '@klarity/sdk';

import { handleRank, RANK_METHOD, onRpcRequest } from '../src/index.js';
import type { RankDeps } from '../src/index.js';

// A descriptor object (the canonical subject the attester hashes over).
const DESCRIPTOR = { intent: 'Approve', fields: [] };

const CONTRACT = '0xd01607c3c5ecaba394d8be377a08590149325722';
const ACCOUNT = '0x00000000000000000000000000000000000000a1';
const TX_OK = '0x' + 'cc'.repeat(32);

const PARAMS = {
  chainId: 1,
  contract: CONTRACT,
  selector: '0x04f04769',
  interactionTxHash: TX_OK,
  account: ACCOUNT,
};

// Fake ethers provider mirroring sdk/test/public-attest.test.ts: getTransaction
// returns a canned tx, getTransactionReceipt returns a canned receipt.
function fakeProvider(opts: {
  txs: Record<string, { to: string | null; from: string } | null>;
  mined: Set<string>;
}) {
  return {
    async getTransaction(hash: string) {
      return opts.txs[hash] ?? null;
    },
    async getTransactionReceipt(hash: string) {
      if (!opts.mined.has(hash)) return null;
      return { status: 1 };
    },
  };
}

const provider = fakeProvider({
  txs: { [TX_OK]: { to: CONTRACT, from: ACCOUNT } },
  mined: new Set([TX_OK]),
});

// Build injectable deps with a confirm stub and the default empty-UID MAINNET
// profile (publicSchemaUID === '' → submitVouch refuses, proving no live write).
function depsWith(over: Partial<RankDeps> = {}): RankDeps {
  const profile = over.profile ?? MAINNET;
  return {
    confirm: async () => true,
    attester: new KlarityAttester({ profile }),
    provider,
    fetchDescriptor: async () => DESCRIPTOR,
    profile,
    ...over,
  };
}

describe('handleRank', () => {
  it('(a) returns declined and never submits when the user says no', async () => {
    let submitReached = false;
    const deps = depsWith({
      confirm: async () => false,
      // An attester whose attestPublic would throw if ever reached.
      attester: {
        async verifyInteraction() {
          submitReached = true;
          return true;
        },
        async attestPublic() {
          submitReached = true;
          return '0xdead';
        },
      } as unknown as RankDeps['attester'],
    });
    const result = await handleRank(PARAMS, deps);
    expect(result).toEqual({ submitted: false, reason: 'declined' });
    expect(submitReached).toBe(false);
  });

  it('(b) on confirm, the empty-UID profile yields the gated not-registered refusal', async () => {
    const result = await handleRank(PARAMS, depsWith());
    expect(result.submitted).toBe(false);
    expect(result.reason).toMatch(/not registered/u);
  });

  it('(c) on confirm, a registered-UID profile with a mined claim reaches attestPublic', async () => {
    const PROFILE = { ...MAINNET, publicSchemaUID: '0x' + '77'.repeat(32) };
    const UID = '0x' + '11'.repeat(32);
    // readAttestations is irrelevant for submit (verifyInteraction uses the
    // provider only); attestPublic is stubbed by overriding it on the instance.
    const attester = new KlarityAttester({ profile: PROFILE });
    (attester as unknown as { attestPublic: (d: object, c: unknown) => Promise<string> }).attestPublic =
      async () => UID;
    const result = await handleRank(PARAMS, depsWith({ profile: PROFILE, attester }));
    expect(result).toEqual({ submitted: true, uid: UID });
  });

  it('passes the fetched descriptor through to the attester', async () => {
    const PROFILE = { ...MAINNET, publicSchemaUID: '0x' + '77'.repeat(32) };
    let seen: object | undefined;
    const attester = new KlarityAttester({ profile: PROFILE });
    (attester as unknown as { attestPublic: (d: object, c: unknown) => Promise<string> }).attestPublic =
      async (d: object) => {
        seen = d;
        return '0x' + '22'.repeat(32);
      };
    await handleRank(PARAMS, depsWith({ profile: PROFILE, attester }));
    expect(seen).toBe(DESCRIPTOR);
  });
});

describe('onRpcRequest', () => {
  it('throws method-not-found for an unknown method', async () => {
    await expect(
      onRpcRequest({
        origin: 'https://dapp.example',
        request: { method: 'klarity_unknown', params: {}, id: 1, jsonrpc: '2.0' },
      }),
    ).rejects.toThrow();
  });

  it('exports RANK_METHOD as klarity_rank', () => {
    expect(RANK_METHOD).toBe('klarity_rank');
  });

  // descriptorHash is imported to keep the subject-binding contract visible: the
  // attester hashes the SAME descriptor object handleRank fetches and submits.
  it('descriptorHash is a usable pure function over the descriptor', () => {
    expect(descriptorHash(DESCRIPTOR)).toMatch(/^0x[0-9a-f]{64}$/u);
  });
});
