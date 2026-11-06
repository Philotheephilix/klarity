import { describe, it, expect } from 'vitest';
import { encodeAbiParameters, parseAbiParameters, size } from 'viem';
import { decodePermit } from '../src/decode/permit.js';

// Fixtures match 1inch SafeERC20.tryPermit's real on-wire lengths, discriminated
// by exact byte length:
//   224 -> full EIP-2612  (owner, spender, value, deadline, v, r, s)      7 words
//   256 -> full DAI       (holder, spender, nonce, expiry, allowed, v,r,s) 8 words
//   352 -> full Permit2   (owner, PermitSingle, bytes64 signature)
function eip2612Blob(): string {
  return encodeAbiParameters(
    parseAbiParameters('address,address,uint256,uint256,uint8,bytes32,bytes32'),
    [
      `0x${'11'.repeat(20)}`,
      `0x${'22'.repeat(20)}`,
      1000n,
      1999999999n,
      27,
      `0x${'aa'.repeat(32)}`,
      `0x${'bb'.repeat(32)}`,
    ],
  );
}
function daiBlob(): string {
  return encodeAbiParameters(
    parseAbiParameters('address,address,uint256,uint256,bool,uint8,bytes32,bytes32'),
    [
      `0x${'33'.repeat(20)}`,
      `0x${'44'.repeat(20)}`,
      5n,
      1888888888n,
      true,
      28,
      `0x${'cc'.repeat(32)}`,
      `0x${'dd'.repeat(32)}`,
    ],
  );
}
function permit2Blob(): string {
  return encodeAbiParameters(
    parseAbiParameters('address,((address,uint160,uint48,uint48),address,uint256),bytes'),
    [
      `0x${'55'.repeat(20)}`,
      [[`0x${'66'.repeat(20)}`, 7777n, 111, 3], `0x${'77'.repeat(20)}`, 1777777777n],
      `0x${'5a'.repeat(64)}`,
    ],
  );
}

describe('decodePermit — length-discriminated permit decoding', () => {
  it('fixture byte lengths are the real 1inch full-form lengths (224 / 256 / 352)', () => {
    expect(size(eip2612Blob() as `0x${string}`)).toBe(224);
    expect(size(daiBlob() as `0x${string}`)).toBe(256);
    expect(size(permit2Blob() as `0x${string}`)).toBe(352);
  });

  it('decodes a full EIP-2612 permit (224 bytes)', () => {
    const p = decodePermit(eip2612Blob());
    expect(p.format).toBe('eip2612');
    const labels = p.fields.map((f) => f.label);
    expect(labels).toContain('Value');
    expect(labels).toContain('Deadline');
    expect(p.fields.find((f) => f.label === 'Value')?.value).toBe('1000');
    expect(p.fields.find((f) => f.label === 'Deadline')?.value).toBe('1999999999');
    expect(p.raw).toBe(eip2612Blob().toLowerCase());
  });

  it('decodes a full DAI-style permit (256 bytes), never mis-read as EIP-2612', () => {
    const p = decodePermit(daiBlob());
    expect(p.format).toBe('dai');
    const labels = p.fields.map((f) => f.label);
    expect(labels).toContain('Nonce');
    expect(labels).toContain('Expiry');
    expect(labels).toContain('Allowed');
    expect(p.fields.find((f) => f.label === 'Nonce')?.value).toBe('5');
    expect(p.fields.find((f) => f.label === 'Allowed')?.value).toBe('true');
  });

  it('decodes a full Permit2 permit (352 bytes)', () => {
    const p = decodePermit(permit2Blob());
    expect(p.format).toBe('permit2');
    const labels = p.fields.map((f) => f.label);
    expect(labels).toContain('Amount');
    expect(p.fields.find((f) => f.label === 'Amount')?.value).toBe('7777');
  });

  it('unknown-length permit -> format unknown + raw, no throw', () => {
    const odd = `0x${'ab'.repeat(100)}`; // 100 bytes -> actually a compact eip2612 length!
    const trulyOdd = `0x${'ab'.repeat(130)}`; // 130 bytes: no layout
    expect(decodePermit(trulyOdd).format).toBe('unknown');
    expect(decodePermit(trulyOdd).fields).toEqual([]);
    expect(decodePermit(trulyOdd).raw).toBe(trulyOdd);
    // 100-byte is the compact EIP-2612 form; still classified, not unknown.
    expect(decodePermit(odd).format).toBe('eip2612');
  });

  it('empty / non-hex permit -> unknown, no throw', () => {
    expect(decodePermit('0x').format).toBe('unknown');
    expect(decodePermit('').format).toBe('unknown');
    expect(decodePermit('not-hex').format).toBe('unknown');
  });

  it('a right-length but all-zero blob still classifies by length and never throws', () => {
    const zeros = `0x${'00'.repeat(224)}`;
    const p = decodePermit(zeros);
    expect(p.format).toBe('eip2612');
    expect(p.fields.find((f) => f.label === 'Value')?.value).toBe('0');
  });

  it('compact forms classify by their packed lengths (100/72/96)', () => {
    expect(decodePermit(`0x${'ab'.repeat(100)}`).format).toBe('eip2612'); // compact eip2612
    expect(decodePermit(`0x${'ab'.repeat(72)}`).format).toBe('dai'); // compact dai
    expect(decodePermit(`0x${'ab'.repeat(96)}`).format).toBe('permit2'); // compact permit2
  });
});
