import { describe, it, expect } from 'vitest';
import { canonicalSignature, selectorOf } from '../../src/normalize/selector.js';

describe('canonicalSignature', () => {
  it('strips param names, keeps types', () => {
    expect(
      canonicalSignature('depositETH(address pool, address onBehalfOf, uint16 referralCode)'),
    ).toBe('depositETH(address,address,uint16)');
  });

  it('already-canonical signature is unchanged', () => {
    expect(canonicalSignature('transfer(address,uint256)')).toBe('transfer(address,uint256)');
  });

  it('preserves tuple arrays', () => {
    expect(canonicalSignature('foo((address,uint256)[] x)')).toBe('foo((address,uint256)[])');
  });

  it('handles no-arg signatures', () => {
    expect(canonicalSignature('bar()')).toBe('bar()');
    expect(canonicalSignature('createAccount()')).toBe('createAccount()');
  });
});

describe('selectorOf', () => {
  it('transfer(address,uint256) -> 0xa9059cbb', () => {
    expect(selectorOf('transfer(address,uint256)')).toBe('0xa9059cbb');
  });

  it('derives from a signature with param names', () => {
    // depositETH(address,address,uint16)
    expect(selectorOf('depositETH(address pool, address onBehalfOf, uint16 referralCode)')).toBe(
      selectorOf('depositETH(address,address,uint16)'),
    );
  });

  it('returns 0x + 8 hex chars', () => {
    expect(selectorOf('bar()')).toMatch(/^0x[0-9a-f]{8}$/);
  });
});
