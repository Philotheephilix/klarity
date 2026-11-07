import { describe, it, expect } from 'vitest';
import { KlarityAttester } from '../src/attest.js';
import { SEPOLIA, BASE_SEPOLIA, MAINNET } from '../src/config.js';

// Lane-A stage 6 CASE B gate proof: attestDescriptor MUST refuse (throw) on any
// profile whose efSchemaUID is empty, BEFORE touching a chain/signer. This is
// exactly the condition on the only reachable testnet profiles (Sepolia /
// Base-Sepolia), so a real testnet EF write is correctly impossible.
const WETH_SUBJECT = '0x034ddaa1500e3495b64120c7f67dd407e59dc3837bec5d6b8c7ef4b66c0c0757';

describe('Lane-A EF attest gating (CASE B)', () => {
  it('attestDescriptor throws on Sepolia (efSchemaUID EMPTY) with no chain call', async () => {
    expect(SEPOLIA.efSchemaUID).toBe('');
    const a = new KlarityAttester({ profile: SEPOLIA });
    await expect(a.attestDescriptor({ anything: true })).rejects.toThrow(
      /no efSchemaUID registered for chainId 11155111/,
    );
  });

  it('attestDescriptor throws on Base-Sepolia (efSchemaUID EMPTY)', async () => {
    expect(BASE_SEPOLIA.efSchemaUID).toBe('');
    const a = new KlarityAttester({ profile: BASE_SEPOLIA });
    await expect(a.attestDescriptor({ anything: true })).rejects.toThrow(
      /no efSchemaUID registered for chainId 84532/,
    );
  });

  it('MAINNET is the ONLY profile with a non-empty EF schema UID (write forbidden)', () => {
    expect(MAINNET.efSchemaUID).not.toBe('');
    expect(MAINNET.chainId).toBe(1);
  });

  it('public tier is GATED on every profile: publicSchemaUID is EMPTY everywhere', () => {
    expect(MAINNET.publicSchemaUID).toBe('');
    expect(SEPOLIA.publicSchemaUID).toBe('');
    expect(BASE_SEPOLIA.publicSchemaUID).toBe('');
  });

  it('attestPublic throws on MAINNET (publicSchemaUID EMPTY) — public tier not attestable', async () => {
    const a = new KlarityAttester({ profile: MAINNET });
    await expect(
      a.attestPublic(
        { anything: true },
        { contract: '0x'.padEnd(42, '0'), attester: WETH_SUBJECT, interactionTxHash: '0x' + '00'.repeat(32) },
      ),
    ).rejects.toThrow(/no publicSchemaUID registered/);
  });
});
