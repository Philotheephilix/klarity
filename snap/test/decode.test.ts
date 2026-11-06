import { describe, it, expect } from 'vitest';
import type { KlarityClient, DecodeResponse } from '@klarity/sdk';
import { fetchDecode, fetchDecodeOutcome } from '../src/decode.js';

const sampleResponse: DecodeResponse = {
  signing: {
    chainId: 11155111,
    contract: '0xabcdef0000000000000000000000000000000001',
    selector: '0x04f04769',
    kind: 'calldata',
    decodedFrom: 'descriptor',
    interpolatedIntent: null,
    summary: 'Transfer tokens',
  },
  fields: [],
  hiddenFields: [],
  note: '',
  raw: { calldata: '0x04f04769' },
};

const input = {
  chainId: 11155111,
  contract: '0xabcdef0000000000000000000000000000000001',
  calldata: '0x04f04769',
};

function fakeClient(decode: (...args: unknown[]) => unknown): KlarityClient {
  return { decode } as unknown as KlarityClient;
}

describe('fetchDecode', () => {
  it('returns the DecodeResponse when the client resolves', async () => {
    const client = fakeClient(async () => sampleResponse);
    const result = await fetchDecode(input, { client });
    expect(result).toBe(sampleResponse);
  });

  it('passes chainId, contract, and calldata to client.decode', async () => {
    let received: unknown;
    const client = fakeClient(async (arg: unknown) => {
      received = arg;
      return sampleResponse;
    });
    await fetchDecode(input, { client });
    expect(received).toEqual({
      chainId: 11155111,
      contract: '0xabcdef0000000000000000000000000000000001',
      calldata: '0x04f04769',
    });
  });

  it('resolves to null when the client rejects (404/network)', async () => {
    const client = fakeClient(async () => {
      throw new Error('404 Not Found');
    });
    await expect(fetchDecode(input, { client })).resolves.toBeNull();
  });

  it('resolves to null when the client throws synchronously', async () => {
    const client = fakeClient(() => {
      throw new Error('boom');
    });
    await expect(fetchDecode(input, { client })).resolves.toBeNull();
  });
});

describe('fetchDecodeOutcome', () => {
  it('returns ok with the decode on success', async () => {
    const client = fakeClient(async () => sampleResponse);
    const outcome = await fetchDecodeOutcome(input, { client });
    expect(outcome).toEqual({ ok: true, decode: sampleResponse });
  });

  it('maps a 404 to a genuine "none" (reachable API, no descriptor)', async () => {
    const client = fakeClient(async () => {
      // Shape mirrors KlarityClient's thrown message on a 404.
      throw new Error('KlarityClient: POST /decode failed with 404: not found');
    });
    const outcome = await fetchDecodeOutcome(input, { client });
    expect(outcome).toEqual({ ok: false, reason: 'none' });
  });

  it('maps a transport/other error to "error" with the message', async () => {
    const client = fakeClient(async () => {
      throw new Error('Failed to fetch');
    });
    const outcome = await fetchDecodeOutcome(input, { client });
    expect(outcome).toEqual({
      ok: false,
      reason: 'error',
      message: 'Failed to fetch',
    });
  });

  it('maps a non-404 HTTP error (5xx) to "error"', async () => {
    const client = fakeClient(async () => {
      throw new Error('KlarityClient: POST /decode failed with 500');
    });
    const outcome = await fetchDecodeOutcome(input, { client });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('error');
  });
});
