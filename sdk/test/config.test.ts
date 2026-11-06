import { describe, it, expect } from 'vitest';
import {
  MAINNET,
  SEPOLIA,
  BASE_SEPOLIA,
  EF_SCHEMA_STRING,
  PUBLIC_SCHEMA_STRING,
} from '../src/config.js';

describe('EAS chain config profiles', () => {
  it('MAINNET carries the pinned EAS contract, chainId, and EF schema UID', () => {
    expect(MAINNET.chainId).toBe(1);
    expect(MAINNET.easContract).toBe('0xA1207F3BBa224E2c9c3c6D5aF63D0eb1582Ce587');
    expect(MAINNET.efSchemaUID).toBe('0xe023eef113c1670774801c34b377fdf612dd8a4d2fa92fe382e15bd91fafb5c2');
  });

  it('EF_SCHEMA_STRING is exactly the canonical ERC-8176 schema', () => {
    expect(EF_SCHEMA_STRING).toBe('bytes32 descriptorHash');
  });

  it('PUBLIC_SCHEMA_STRING is exactly the 4-field extended schema', () => {
    expect(PUBLIC_SCHEMA_STRING).toBe(
      'bytes32 descriptorHash,address contract,uint256 chainId,bytes32 interactionTxHash',
    );
  });

  it('SEPOLIA and BASE_SEPOLIA have distinct non-empty EAS contracts', () => {
    expect(SEPOLIA.easContract).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(BASE_SEPOLIA.easContract).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(SEPOLIA.easContract.toLowerCase()).not.toBe(BASE_SEPOLIA.easContract.toLowerCase());
    expect(SEPOLIA.chainId).toBe(11155111);
    expect(BASE_SEPOLIA.chainId).toBe(84532);
  });

  it('an unregistered public schema UID is the empty string, never a fabricated value', () => {
    // UID is either empty (unregistered on that chain) or a valid 0x+64hex; never a made-up hex.
    for (const p of [MAINNET, SEPOLIA, BASE_SEPOLIA]) {
      expect(p.publicSchemaUID === '' || /^0x[0-9a-fA-F]{64}$/.test(p.publicSchemaUID)).toBe(true);
    }
  });
});
