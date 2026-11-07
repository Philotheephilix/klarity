import { describe, it, expect, vi } from 'vitest';
import type {
  InteractionClaim,
  InteractionProvider,
  EasProfile,
  KlarityAttester,
} from '@klarity/sdk';
import { buildClaim, submitVouch } from '../src/ranking.js';

const CONTRACT = '0xd01607c3c5ecaba394d8be377a08590149325722';
const ATTESTER_A = '0x00000000000000000000000000000000000000a1';
const ATTESTER_B = '0x00000000000000000000000000000000000000b2';
const TX_OK = '0x' + 'cc'.repeat(32);
const TX_FORGED = '0x' + 'dd'.repeat(32);
const REGISTERED_UID = '0x' + '77'.repeat(32);
const RESULT_UID = '0x' + '42'.repeat(32);

const DESCRIPTOR = { intent: 'Approve', fields: [] };

// Fake ethers-shaped provider implementing BOTH methods verifyInteraction uses.
function fakeProvider(opts: {
  txs: Record<string, { to: string | null; from: string } | null>;
  mined: Set<string>;
}): InteractionProvider {
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
  txs: {
    [TX_OK]: { to: CONTRACT, from: ATTESTER_A },
    [TX_FORGED]: { to: CONTRACT, from: ATTESTER_B }, // from != claimed attester A
  },
  mined: new Set([TX_OK, TX_FORGED]),
});

// A minimal attester stub typed to the two methods submitVouch touches. Using a
// real KlarityAttester would pull ethers; the stub keeps the test chain-free.
function stubAttester(
  over: Partial<Pick<KlarityAttester, 'verifyInteraction' | 'attestPublic'>>,
): KlarityAttester {
  return {
    verifyInteraction: vi.fn(async () => true),
    attestPublic: vi.fn(async () => RESULT_UID),
    ...over,
  } as unknown as KlarityAttester;
}

const profileWith = (publicSchemaUID: string): EasProfile => ({
  chainId: 11155111,
  easContract: '0xC2679fBD37d54388Ce493F1DB75320D236e1815e',
  efSchemaUID: '',
  publicSchemaUID,
});

describe('buildClaim', () => {
  it('shapes an InteractionClaim from the three address/hash args', () => {
    const claim: InteractionClaim = buildClaim({
      contract: CONTRACT,
      attester: ATTESTER_A,
      interactionTxHash: TX_OK,
    });
    expect(claim).toEqual({
      contract: CONTRACT,
      attester: ATTESTER_A,
      interactionTxHash: TX_OK,
    });
  });
});

describe('submitVouch gate (publicSchemaUID empty)', () => {
  it('refuses to submit and never calls attestPublic', async () => {
    const attester = stubAttester({});
    const claim = buildClaim({
      contract: CONTRACT,
      attester: ATTESTER_A,
      interactionTxHash: TX_OK,
    });
    const r = await submitVouch(DESCRIPTOR, claim, {
      attester,
      provider,
      profile: profileWith(''),
    });
    expect(r.submitted).toBe(false);
    expect(r.reason).toMatch(/not registered/);
    expect(attester.attestPublic).not.toHaveBeenCalled();
    expect(attester.verifyInteraction).not.toHaveBeenCalled();
  });
});

describe('submitVouch verify gate (forged claim)', () => {
  it('refuses to submit when the interaction is not proven', async () => {
    const attester = stubAttester({ verifyInteraction: vi.fn(async () => false) });
    const claim = buildClaim({
      contract: CONTRACT,
      attester: ATTESTER_A, // claims A, but TX_FORGED was sent by B
      interactionTxHash: TX_FORGED,
    });
    const r = await submitVouch(DESCRIPTOR, claim, {
      attester,
      provider,
      profile: profileWith(REGISTERED_UID),
    });
    expect(r.submitted).toBe(false);
    expect(r.reason).toMatch(/not proven/);
    expect(attester.verifyInteraction).toHaveBeenCalledOnce();
    expect(attester.attestPublic).not.toHaveBeenCalled();
  });
});

describe('submitVouch happy path (proven interaction, registered schema)', () => {
  it('submits and returns the uid once attestPublic resolves', async () => {
    const attester = stubAttester({});
    const claim = buildClaim({
      contract: CONTRACT,
      attester: ATTESTER_A,
      interactionTxHash: TX_OK,
    });
    const r = await submitVouch(DESCRIPTOR, claim, {
      attester,
      provider,
      profile: profileWith(REGISTERED_UID),
    });
    expect(r.submitted).toBe(true);
    expect(r.uid).toBe(RESULT_UID);
    expect(attester.verifyInteraction).toHaveBeenCalledOnce();
    expect(attester.attestPublic).toHaveBeenCalledOnce();
    expect(attester.attestPublic).toHaveBeenCalledWith(DESCRIPTOR, claim);
  });
});
