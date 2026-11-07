import { describe, it, expect } from 'vitest';
import { KlarityClient } from '../src/client.js';

/** A mock fetch that records the last call and returns a canned JSON body. */
function mockFetch(body: unknown, status = 200) {
  const calls: Array<{ url: string; method: string; body?: string; headers?: Record<string, string> }> = [];
  const fn = (async (input: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: init?.body as string | undefined,
      headers: (init?.headers as Record<string, string>) ?? undefined,
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('KlarityClient', () => {
  it('getDescriptor GETs the lower-cased identity path and returns the parsed body', async () => {
    const { fn, calls } = mockFetch({ $key: '0xabc', chainId: 1, contract: '0xAbc', selector: '0x04f04769', kind: 'calldata' });
    const client = new KlarityClient({ baseUrl: 'http://x', fetch: fn });
    const res = await client.getDescriptor(1, '0xAbC', '0x04f04769');
    expect(calls[0].url).toBe('http://x/descriptors/1/0xabc/0x04f04769');
    expect(calls[0].method).toBe('GET');
    expect(res.chainId).toBe(1);
  });

  it('listByContract GETs the contract path (lower-cased)', async () => {
    const { fn, calls } = mockFetch([]);
    const client = new KlarityClient({ baseUrl: 'http://x', fetch: fn });
    await client.listByContract(1, '0xAbC');
    expect(calls[0].url).toBe('http://x/descriptors/1/0xabc');
    expect(calls[0].method).toBe('GET');
  });

  it('browse builds a query string from filters', async () => {
    const { fn, calls } = mockFetch([]);
    const client = new KlarityClient({ baseUrl: 'http://x', fetch: fn });
    await client.browse({ chainId: 1, kind: 'calldata' });
    expect(calls[0].url).toBe('http://x/descriptors?chainId=1&kind=calldata');
  });

  it('decode POSTs a JSON body to /decode', async () => {
    const { fn, calls } = mockFetch({ signing: {}, fields: [], hiddenFields: [], note: '', raw: {} });
    const client = new KlarityClient({ baseUrl: 'http://x', fetch: fn });
    await client.decode({ chainId: 1, contract: '0xdef', calldata: '0x474cf53d' });
    expect(calls[0].url).toBe('http://x/decode');
    expect(calls[0].method).toBe('POST');
    expect(JSON.parse(calls[0].body as string)).toEqual({ chainId: 1, contract: '0xdef', calldata: '0x474cf53d' });
    expect(calls[0].headers?.['Content-Type']).toBe('application/json');
  });

  it('getNonce GETs /nonce/:address and returns the nonce', async () => {
    const { fn, calls } = mockFetch({ nonce: '1793955061051' });
    const client = new KlarityClient({ baseUrl: 'http://x', fetch: fn });
    const res = await client.getNonce('0x9236');
    expect(calls[0].url).toBe('http://x/nonce/0x9236');
    expect(res.nonce).toBe('1793955061051');
  });

  it('throws on a non-2xx response, carrying the status', async () => {
    const { fn } = mockFetch({ error: 'Not Found' }, 404);
    const client = new KlarityClient({ baseUrl: 'http://x', fetch: fn });
    await expect(client.getDescriptor(1, '0xabc', '0x04f04769')).rejects.toThrow(/404/);
  });

  it('strips a trailing slash from baseUrl', async () => {
    const { fn, calls } = mockFetch([]);
    const client = new KlarityClient({ baseUrl: 'http://x/', fetch: fn });
    await client.listByContract(1, '0xabc');
    expect(calls[0].url).toBe('http://x/descriptors/1/0xabc');
  });

  it('rejects when a configured timeout elapses before the fetch settles', async () => {
    // A fetch that never resolves on its own: it only settles if its signal
    // aborts. With timeoutMs set, the client's AbortController must fire and
    // reject the request, so a hung server can never block the caller forever.
    const neverResolves = ((_input: string | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason ?? new Error('aborted'));
        });
      })) as unknown as typeof fetch;

    const client = new KlarityClient({
      baseUrl: 'http://x',
      fetch: neverResolves,
      timeoutMs: 20,
    });
    await expect(
      client.decode({ chainId: 1, contract: '0xdef', calldata: '0x474cf53d' }),
    ).rejects.toThrow(/timed out/);
  });

  it('does not abort a fast request when a timeout is configured', async () => {
    const { fn } = mockFetch({ nonce: '1' });
    const client = new KlarityClient({ baseUrl: 'http://x', fetch: fn, timeoutMs: 1000 });
    const res = await client.getNonce('0x1');
    expect(res.nonce).toBe('1');
  });
});
