import { describe, it, expect } from 'vitest';
import type { Attestation } from '@ethereum-attestation-service/eas-sdk';
import {
  KlarityAttester,
  encodePublicData,
  decodePublicData,
} from '../src/attest.js';
import { descriptorHash } from '../src/hash.js';
import { MAINNET } from '../src/config.js';

// MAINNET has no public schema registered yet (publicSchemaUID is ''), so verify
// paths would short-circuit. Tests use a profile with a registered UID.
const PROFILE = { ...MAINNET, publicSchemaUID: '0x' + '77'.repeat(32) };

const DESCRIPTOR = { intent: 'Approve', fields: [] };

const CONTRACT = '0xd01607c3c5ecaba394d8be377a08590149325722';
const ATTESTER_A = '0x00000000000000000000000000000000000000a1';
const ATTESTER_B = '0x00000000000000000000000000000000000000b2';
const TX_OK = '0x' + 'cc'.repeat(32);
const TX_FORGED = '0x' + 'dd'.repeat(32);
const TX_WRONG_TO = '0x' + 'ee'.repeat(32);
const TX_UNMINED = '0x' + 'ff'.repeat(32);

// A fake ethers provider: getTransaction returns a canned tx; getTransactionReceipt
// returns a canned receipt (or null for an unmined tx).
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
  txs: {
    [TX_OK]: { to: CONTRACT, from: ATTESTER_A },
    [TX_FORGED]: { to: CONTRACT, from: ATTESTER_B }, // from != claimed attester A
    [TX_WRONG_TO]: { to: '0x000000000000000000000000000000000000dead', from: ATTESTER_A },
    [TX_UNMINED]: { to: CONTRACT, from: ATTESTER_A },
  },
  mined: new Set([TX_OK, TX_FORGED, TX_WRONG_TO]), // TX_UNMINED has no receipt
});

function publicAttestation(over: Partial<Attestation>): Attestation {
  return {
    uid: '0x' + '11'.repeat(32),
    schema: PROFILE.publicSchemaUID,
    refUID: '0x' + '00'.repeat(32),
    time: 1000n,
    expirationTime: 0n,
    revocationTime: 0n,
    recipient: '0x0000000000000000000000000000000000000000',
    revocable: true,
    attester: ATTESTER_A,
    data: '0x',
    ...over,
  };
}

describe('encodePublicData / decodePublicData', () => {
  it('round-trips the 4-field public schema', () => {
    const h = '0x' + 'ab'.repeat(32);
    const encoded = encodePublicData({
      descriptorHash: h,
      contract: CONTRACT,
      chainId: 1,
      interactionTxHash: TX_OK,
    });
    const decoded = decodePublicData(encoded);
    expect(decoded.descriptorHash.toLowerCase()).toBe(h.toLowerCase());
    expect(decoded.contract.toLowerCase()).toBe(CONTRACT.toLowerCase());
    expect(Number(decoded.chainId)).toBe(1);
    expect(decoded.interactionTxHash.toLowerCase()).toBe(TX_OK.toLowerCase());
  });
});

describe('KlarityAttester.verifyInteraction (forgery resistance)', () => {
  const attester = new KlarityAttester({ profile: PROFILE });

  it('true for a mined tx whose to==contract and from==attester', async () => {
    const ok = await attester.verifyInteraction(provider, {
      contract: CONTRACT,
      attester: ATTESTER_A,
      interactionTxHash: TX_OK,
    });
    expect(ok).toBe(true);
  });

  it('false when the tx is not found', async () => {
    const r = await attester.verifyInteraction(provider, {
      contract: CONTRACT,
      attester: ATTESTER_A,
      interactionTxHash: '0x' + '99'.repeat(32),
    });
    expect(r).toBe(false);
  });

  it('false when to != contract', async () => {
    const r = await attester.verifyInteraction(provider, {
      contract: CONTRACT,
      attester: ATTESTER_A,
      interactionTxHash: TX_WRONG_TO,
    });
    expect(r).toBe(false);
  });

  it('false when from != attester (the forgery: borrowed someone else tx)', async () => {
    const r = await attester.verifyInteraction(provider, {
      contract: CONTRACT,
      attester: ATTESTER_A, // claims A, but TX_FORGED was sent by B
      interactionTxHash: TX_FORGED,
    });
    expect(r).toBe(false);
  });

  it('false when the tx is unmined (no receipt)', async () => {
    const r = await attester.verifyInteraction(provider, {
      contract: CONTRACT,
      attester: ATTESTER_A,
      interactionTxHash: TX_UNMINED,
    });
    expect(r).toBe(false);
  });
});

describe('KlarityAttester.verifyPublic + verifyDescriptor', () => {
  // The candidate public attestations: A has a valid interaction, B's points at
  // the forged tx, and a duplicate of A should not double-count.
  function attesterWith(candidates: Attestation[], efCandidates: Attestation[] = []): KlarityAttester {
    return new KlarityAttester({
      profile: PROFILE,
      readAttestations: async (schemaUID) =>
        schemaUID === PROFILE.publicSchemaUID ? candidates : efCandidates,
    });
  }

  function pubData(attester: string, txHash: string): string {
    return encodePublicData({
      descriptorHash: descriptorHash(DESCRIPTOR),
      contract: CONTRACT,
      chainId: 1,
      interactionTxHash: txHash,
    });
  }

  it('counts only interaction-verified attestations and dedupes by attester', async () => {
    const a = attesterWith([
      publicAttestation({ attester: ATTESTER_A, data: pubData(ATTESTER_A, TX_OK), uid: '0x' + 'a1'.repeat(32) }),
      // forgery: B vouches but points at TX_OK, which was sent by A, not B.
      publicAttestation({ attester: ATTESTER_B, data: pubData(ATTESTER_B, TX_OK), uid: '0x' + 'b2'.repeat(32) }),
      publicAttestation({ attester: ATTESTER_A, data: pubData(ATTESTER_A, TX_OK), uid: '0x' + 'a3'.repeat(32) }),
    ]);
    const r = await a.verifyPublic(DESCRIPTOR, { provider });
    expect(r.publicVouches).toBe(1); // only A verifies; B forged (TX_OK is A's tx); A deduped
    expect(r.rankedAttesters).toHaveLength(1);
    expect(r.rankedAttesters[0].attester.toLowerCase()).toBe(ATTESTER_A);
    expect(r.rankedAttesters[0].interactionTxHash.toLowerCase()).toBe(TX_OK.toLowerCase());
  });

  it('excludes a vouch whose encoded descriptorHash does not match the descriptor (wrong-subject forgery)', async () => {
    // A sends a real tx to CONTRACT and signs a valid-looking public vouch, but
    // the vouch's encoded descriptorHash is for a DIFFERENT descriptor. It must
    // not count toward THIS descriptor's ranking even though the interaction is
    // genuine — the subject binding is what makes the vouch specific.
    const wrongSubject = encodePublicData({
      descriptorHash: '0x' + 'ab'.repeat(32), // not hashOf(DESCRIPTOR)
      contract: CONTRACT,
      chainId: 1,
      interactionTxHash: TX_OK,
    });
    const a = attesterWith([
      publicAttestation({ attester: ATTESTER_A, data: wrongSubject, uid: '0x' + 'c3'.repeat(32) }),
    ]);
    const r = await a.verifyPublic(DESCRIPTOR, { provider });
    expect(r.publicVouches).toBe(0);
    expect(r.rankedAttesters).toHaveLength(0);
  });

  it('verifyEf returns not-approved when efSchemaUID is empty (unregistered chain)', async () => {
    // Mirror of the verifyPublic empty-schema guard: on a chain with no EF
    // schema registered, verifyEf must short-circuit to not-approved rather
    // than query a zero/empty schema UID.
    const noEf = new KlarityAttester({
      profile: { ...PROFILE, efSchemaUID: '' },
      readAttestations: async () => {
        throw new Error('readAttestations must not be called when efSchemaUID is empty');
      },
    });
    const v = await noEf.verifyEf(DESCRIPTOR, { trustedAttesters: [ATTESTER_A] });
    expect(v.efApproved).toBe(false);
    expect(v.efAttester).toBeUndefined();
  });

  it('verifyDescriptor merges both tiers into a VerifiedBlock', async () => {
    const efOk = publicAttestation({
      schema: PROFILE.efSchemaUID,
      attester: ATTESTER_A,
      uid: '0x' + 'ef'.repeat(32),
    });
    const a = attesterWith(
      [publicAttestation({ attester: ATTESTER_A, data: pubData(ATTESTER_A, TX_OK) })],
      [efOk],
    );
    const block = await a.verifyDescriptor(DESCRIPTOR, {
      trustedAttesters: [ATTESTER_A],
      provider,
    });
    expect(block.efApproved).toBe(true);
    expect(block.efAttester?.toLowerCase()).toBe(ATTESTER_A);
    expect(block.publicVouches).toBe(1);
    expect(block.rankedAttesters).toHaveLength(1);
  });
});
