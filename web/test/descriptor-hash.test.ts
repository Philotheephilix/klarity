import { describe, it, expect } from 'vitest';
import { descriptorHash } from '../lib/descriptor-hash';

// The Universal Router descriptor literal from scripts/submit-ur-descriptor.mjs.
// Its hash is pinned: if the browser's canonicalize+keccak256 ever drifts from
// the server's src/hash.ts, this vector breaks and every write would 400 on
// HASH_MISMATCH. This test is the drift guard.
const UR_DESCRIPTOR = {
  context: {
    contract: {
      deployments: [
        { chainId: 1, address: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af' },
      ],
    },
  },
  metadata: { owner: 'Uniswap' },
  display: {
    formats: {
      'execute(bytes commands, bytes[] inputs, uint256 deadline)': {
        __signature: 'execute(bytes commands, bytes[] inputs, uint256 deadline)',
        intent: 'Universal Router batch',
        fields: [
          { label: 'Commands', path: 'commands', format: 'raw' },
          { label: 'Inputs (count)', path: 'inputs.[]', format: 'raw' },
          { label: 'Deadline', path: 'deadline', format: 'raw' },
        ],
      },
    },
  },
};

const KNOWN_HASH =
  '0x38011231f0c641df9a4d77b1ac628a6edaf19ce0bb1c24c9a5e16bee8ed2f549';

describe('descriptorHash', () => {
  it('reproduces the server-side hash for the UR descriptor (drift guard)', () => {
    expect(descriptorHash(UR_DESCRIPTOR)).toBe(KNOWN_HASH);
  });

  it('is independent of key insertion order (RFC 8785 canonicalization)', () => {
    const reordered = {
      display: UR_DESCRIPTOR.display,
      metadata: UR_DESCRIPTOR.metadata,
      context: UR_DESCRIPTOR.context,
    };
    expect(descriptorHash(reordered)).toBe(KNOWN_HASH);
  });

  it('changes when a field value changes', () => {
    const mutated = JSON.parse(JSON.stringify(UR_DESCRIPTOR));
    mutated.metadata.owner = 'NotUniswap';
    expect(descriptorHash(mutated)).not.toBe(KNOWN_HASH);
  });
});
