import { describe, it, expect } from 'vitest';
import { descriptorHash } from '../src/hash.js';

describe('descriptorHash', () => {
  it('produces equal hashes regardless of key order', () => {
    expect(descriptorHash({ a: 1, b: 2 })).toBe(descriptorHash({ b: 2, a: 1 }));
  });

  it('produces a different hash when a value changes', () => {
    expect(descriptorHash({ a: 1, b: 2 })).not.toBe(descriptorHash({ a: 1, b: 3 }));
  });

  it('outputs 0x followed by 64 lowercase hex chars', () => {
    expect(descriptorHash({ a: 1, b: 2 })).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
