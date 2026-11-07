import { describe, it, expect } from 'vitest';
import { capFractionDigits, formatAmount, resolveToken } from '../src/token.js';

/**
 * Encode a uint8 return (decimals) as a 32-byte ABI word, 0x-prefixed.
 */
function decimalsReturn(d: number): string {
  return `0x${d.toString(16).padStart(64, '0')}`;
}

/**
 * Encode a dynamic ABI `string` return (offset=0x20, length, utf-8 bytes
 * right-padded to a 32-byte boundary), the standard `symbol()` return shape.
 */
function stringReturn(s: string): string {
  const bytes = Buffer.from(s, 'utf-8');
  const len = bytes.length.toString(16).padStart(64, '0');
  const dataWords = Math.ceil(bytes.length / 32) || 0;
  const data = Buffer.concat([
    bytes,
    Buffer.alloc(dataWords * 32 - bytes.length),
  ]).toString('hex');
  const offset = (32).toString(16).padStart(64, '0');
  return `0x${offset}${len}${data}`;
}

const DECIMALS_SELECTOR = '0x313ce567';
const SYMBOL_SELECTOR = '0x95d89b41';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

describe('formatAmount', () => {
  it('formats 1000000 with 6 decimals as 1.0', () => {
    expect(formatAmount('1000000', 6)).toBe('1.0');
  });

  it('keeps a full fractional part without float precision loss', () => {
    expect(formatAmount('12345678', 4)).toBe('1234.5678');
  });

  it('pads small values below one unit', () => {
    expect(formatAmount('1', 6)).toBe('0.000001');
  });

  it('renders zero decimals as a plain integer with a trailing .0', () => {
    expect(formatAmount('42', 0)).toBe('42.0');
  });

  it('trims trailing fractional zeros but keeps at least one', () => {
    expect(formatAmount('1500000', 6)).toBe('1.5');
  });
});

describe('capFractionDigits', () => {
  it('keeps 4 significant fractional digits past leading zeros', () => {
    expect(capFractionDigits('0.000444551696531516')).toBe('0.0004445');
  });

  it('leaves an already-short fraction untouched', () => {
    expect(capFractionDigits('1.23')).toBe('1.23');
  });

  it('keeps the single zero of a whole amount', () => {
    expect(capFractionDigits('1.0')).toBe('1.0');
  });

  it('returns an integer (no dot) unchanged', () => {
    expect(capFractionDigits('42')).toBe('42');
  });

  it('truncates toward zero rather than rounding up', () => {
    // 5th significant digit is 5 but we truncate, never overstating the amount.
    expect(capFractionDigits('0.00012349')).toBe('0.0001234');
  });

  it('respects a custom significant-digit cap', () => {
    expect(capFractionDigits('0.000444551696531516', 2)).toBe('0.00044');
  });

  it('trims trailing zeros inside the kept window', () => {
    expect(capFractionDigits('1.2500')).toBe('1.25');
  });
});

describe('resolveToken', () => {
  it('returns null (never throws) when the provider rejects', async () => {
    const provider = {
      async request(): Promise<unknown> {
        throw new Error('rpc down');
      },
    };
    await expect(resolveToken(provider, USDC)).resolves.toBeNull();
  });

  it('resolves decimals + symbol from two eth_calls', async () => {
    const provider = {
      async request(args: { method: string; params?: unknown[] }): Promise<unknown> {
        const call = (args.params?.[0] ?? {}) as { data?: string };
        if (call.data === DECIMALS_SELECTOR) return decimalsReturn(6);
        if (call.data === SYMBOL_SELECTOR) return stringReturn('USDC');
        throw new Error(`unexpected call ${String(call.data)}`);
      },
    };
    // Distinct, uncached address so a prior test's cached null cannot mask it.
    const addr = '0x4444444444444444444444444444444444444444';
    const meta = await resolveToken(provider, addr);
    expect(meta).toEqual({ decimals: 6, symbol: 'USDC' });
  });

  it('returns null when the decimals call fails', async () => {
    const provider = {
      async request(args: { method: string; params?: unknown[] }): Promise<unknown> {
        const call = (args.params?.[0] ?? {}) as { data?: string };
        if (call.data === SYMBOL_SELECTOR) return stringReturn('USDC');
        throw new Error('decimals revert');
      },
    };
    // A fresh (uncached) address so a prior success cannot mask this.
    const other = '0x1111111111111111111111111111111111111111';
    await expect(resolveToken(provider, other)).resolves.toBeNull();
  });

  it('falls back to an empty symbol when only symbol decode fails', async () => {
    const provider = {
      async request(args: { method: string; params?: unknown[] }): Promise<unknown> {
        const call = (args.params?.[0] ?? {}) as { data?: string };
        if (call.data === DECIMALS_SELECTOR) return decimalsReturn(18);
        if (call.data === SYMBOL_SELECTOR) return '0x'; // undecodable symbol
        throw new Error('unexpected');
      },
    };
    const other = '0x2222222222222222222222222222222222222222';
    const meta = await resolveToken(provider, other);
    expect(meta).toEqual({ decimals: 18, symbol: '' });
  });

  it('caches per address (second call makes no provider request)', async () => {
    let calls = 0;
    const provider = {
      async request(args: { method: string; params?: unknown[] }): Promise<unknown> {
        calls += 1;
        const call = (args.params?.[0] ?? {}) as { data?: string };
        if (call.data === DECIMALS_SELECTOR) return decimalsReturn(8);
        if (call.data === SYMBOL_SELECTOR) return stringReturn('WBTC');
        throw new Error('unexpected');
      },
    };
    const addr = '0x3333333333333333333333333333333333333333';
    await resolveToken(provider, addr);
    const callsAfterFirst = calls;
    await resolveToken(provider, addr);
    expect(calls).toBe(callsAfterFirst);
  });
});
