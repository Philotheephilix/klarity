import { describe, it, expect } from 'vitest';
import { descriptorHash } from '../src/hash.js';

describe('sdk scaffold', () => {
  it('re-exports descriptorHash producing a 0x keccak digest', () => {
    const h = descriptorHash({ b: 2, a: 1 });
    expect(h).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
