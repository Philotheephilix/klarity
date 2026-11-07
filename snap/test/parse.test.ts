import { describe, it, expect } from 'vitest';
import { parseChainId, parseTx } from '../src/parse.js';

describe('parseChainId', () => {
  it('parses a CAIP-2 eip155 chain id', () => {
    expect(parseChainId('eip155:11155111')).toBe(11155111);
  });

  it('parses mainnet', () => {
    expect(parseChainId('eip155:1')).toBe(1);
  });

  it('throws on a non-CAIP-2 string', () => {
    expect(() => parseChainId('foo')).toThrow();
  });

  it('throws when the reference is missing', () => {
    expect(() => parseChainId('eip155:')).toThrow();
  });
});

describe('parseTx', () => {
  it('extracts contract, selector, calldata, and from from a contract call', () => {
    expect(
      parseTx({
        to: '0xABCdef0000000000000000000000000000000001',
        data: '0x04f04769deadbeef',
        from: '0xFEEDc0DE0000000000000000000000000000000A',
      }),
    ).toEqual({
      contract: '0xabcdef0000000000000000000000000000000001',
      selector: '0x04f04769',
      calldata: '0x04f04769deadbeef',
      from: '0xfeedc0de0000000000000000000000000000000a',
    });
  });

  it('reports a null selector for a plain transfer', () => {
    expect(parseTx({ to: '0xABCdef0000000000000000000000000000000001', data: '0x' })).toEqual({
      contract: '0xabcdef0000000000000000000000000000000001',
      selector: null,
      calldata: '0x',
      from: null,
    });
  });

  it('returns all null when fields are missing', () => {
    expect(parseTx({})).toEqual({
      contract: null,
      selector: null,
      calldata: null,
      from: null,
    });
  });
});
