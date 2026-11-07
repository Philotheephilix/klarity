import { describe, it, expect } from 'vitest';
import type { Attestation } from '@ethereum-attestation-service/eas-sdk';
import { KlarityAttester, encodeEfData, decodeEfData } from '../src/attest.js';
import { MAINNET } from '../src/config.js';

// A descriptor whose hash is deterministic via hash.ts.
const DESCRIPTOR = { intent: 'Approve', fields: [] };

const TRUSTED = '0x00000000000000000000000000000000000000ef';
const UNTRUSTED = '0x00000000000000000000000000000000000000aa';

// Build an Attestation fixture for the EF schema. Only the fields verifyEf reads
// are meaningful; the rest are filled with inert placeholders.
function efAttestation(over: Partial<Attestation>): Attestation {
  return {
    uid: '0x' + '11'.repeat(32),
    schema: MAINNET.efSchemaUID,
    refUID: '0x' + '00'.repeat(32),
    time: 1000n,
    expirationTime: 0n,
    revocationTime: 0n,
    recipient: '0x0000000000000000000000000000000000000000',
    revocable: true,
    attester: TRUSTED,
    data: '0x',
    ...over,
  };
}

describe('encodeEfData / decodeEfData', () => {
  it('round-trips a descriptorHash through the bytes32 EF schema', () => {
    const h = '0x' + 'ab'.repeat(32);
    const encoded = encodeEfData(h);
    expect(typeof encoded).toBe('string');
    expect(encoded.startsWith('0x')).toBe(true);
    expect(decodeEfData(encoded).toLowerCase()).toBe(h.toLowerCase());
  });
});

describe('KlarityAttester.verifyEf (EF gate)', () => {
  // A fake reader returns a fixed candidate list regardless of args — verifyEf's
  // job is purely to filter it by trust + revocation + expiry.
  function attesterWith(candidates: Attestation[]): KlarityAttester {
    return new KlarityAttester({
      profile: MAINNET,
      // no live chain: verify needs no signer, only the injected reader
      readAttestations: async () => candidates,
    });
  }

  it('approves when a trusted, live, unrevoked attestation exists', async () => {
    const a = attesterWith([efAttestation({ attester: TRUSTED })]);
    const r = await a.verifyEf(DESCRIPTOR, { trustedAttesters: [TRUSTED] });
    expect(r.efApproved).toBe(true);
    expect(r.efAttester?.toLowerCase()).toBe(TRUSTED);
    expect(r.efAttestationUID).toBeDefined();
  });

  it('rejects a revoked attestation (revocationTime != 0)', async () => {
    const a = attesterWith([efAttestation({ revocationTime: 500n })]);
    const r = await a.verifyEf(DESCRIPTOR, { trustedAttesters: [TRUSTED] });
    expect(r.efApproved).toBe(false);
    expect(r.efAttester).toBeUndefined();
  });

  it('rejects an expired attestation (expirationTime in the past)', async () => {
    const a = attesterWith([efAttestation({ expirationTime: 1n })]);
    const r = await a.verifyEf(DESCRIPTOR, {
      trustedAttesters: [TRUSTED],
      now: 1_000_000n,
    });
    expect(r.efApproved).toBe(false);
  });

  it('rejects an attestation from an untrusted attester', async () => {
    const a = attesterWith([efAttestation({ attester: UNTRUSTED })]);
    const r = await a.verifyEf(DESCRIPTOR, { trustedAttesters: [TRUSTED] });
    expect(r.efApproved).toBe(false);
  });

  it('returns efApproved:false when there are no attestations at all', async () => {
    const a = attesterWith([]);
    const r = await a.verifyEf(DESCRIPTOR, { trustedAttesters: [TRUSTED] });
    expect(r.efApproved).toBe(false);
    expect(r.efAttestationUID).toBeUndefined();
  });

  it('matches trusted attesters case-insensitively', async () => {
    const a = attesterWith([efAttestation({ attester: TRUSTED.toUpperCase().replace('0X', '0x') })]);
    const r = await a.verifyEf(DESCRIPTOR, { trustedAttesters: [TRUSTED] });
    expect(r.efApproved).toBe(true);
  });
});
