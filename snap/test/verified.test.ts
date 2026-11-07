import { describe, it, expect } from 'vitest';
import type { KlarityClient, VerifiedBlock } from '@klarity/sdk';
import { fetchVerified } from '../src/verified.js';

const sampleVerified: VerifiedBlock = {
  efApproved: true,
  efAttester: '0xef00000000000000000000000000000000000001',
  efAttestationUID: '0xuid',
  publicVouches: 2,
  rankedAttesters: [],
};

const chainId = 11155111;
const contract = '0xabcdef0000000000000000000000000000000001';
const selector = '0x04f04769';

function fakeClient(
  getDescriptor: (...args: unknown[]) => unknown,
): KlarityClient {
  return { getDescriptor } as unknown as KlarityClient;
}

describe('fetchVerified', () => {
  it('returns the verified block verbatim when the row carries one', async () => {
    const client = fakeClient(async () => ({ verified: sampleVerified }));
    const result = await fetchVerified(chainId, contract, selector, { client });
    expect(result).toBe(sampleVerified);
  });

  it('returns null when the row has no verified block', async () => {
    const client = fakeClient(async () => ({ verified: undefined }));
    const result = await fetchVerified(chainId, contract, selector, { client });
    expect(result).toBeNull();
  });

  it('resolves to null when getDescriptor rejects', async () => {
    const client = fakeClient(async () => {
      throw new Error('404 Not Found');
    });
    await expect(
      fetchVerified(chainId, contract, selector, { client }),
    ).resolves.toBeNull();
  });
});
