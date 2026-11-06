import { afterEach, describe, expect, it, vi } from 'vitest';
import { KlarityApi } from '../lib/api';
import type { DecodeResponse, DescriptorRow, SingleDescriptor } from '../lib/types';

const BASE = 'https://api.example.test';

function okJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

function errStatus(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => ({ error: 'boom' }),
  } as Response;
}

const SAMPLE_ROW: DescriptorRow = {
  chainId: 1,
  contract: '0xd0a1e359811322d97991e03f863a0c30c2cf029c',
  selector: '0x474cf53d',
  functionName: 'deposit',
  kind: 'calldata',
  intent: 'Deposit into the pool',
  entityName: 'aave',
  contractName: 'WETH Gateway',
  owner: 'aave',
  sourcePath: 'registry/aave/weth.json',
  schemaVersion: '1',
};

const SAMPLE_DECODE: DecodeResponse = {
  signing: {
    chainId: 1,
    contract: '0xd0a1e359811322d97991e03f863a0c30c2cf029c',
    selector: '0x474cf53d',
    kind: 'calldata',
    decodedFrom: 'calldata',
    contractName: 'WETH Gateway',
    functionName: 'deposit',
    intent: 'Deposit into the pool',
    interpolatedIntent: null,
    summary: 'Deposit into the pool',
  },
  fields: [{ label: 'Pool', path: '#.params.pool', hidden: false }],
  hiddenFields: [],
  note: 'Labels and intent come from the ERC-7730 descriptor. Argument values are not ABI-decoded.',
  raw: { calldata: '0x474cf53d' },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('KlarityApi', () => {
  it('listDescriptors GETs the filtered /descriptors URL and returns the array', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okJson([SAMPLE_ROW]));
    const api = new KlarityApi(BASE);

    const rows = await api.listDescriptors({ entityName: 'aave' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe(`${BASE}/descriptors?entityName=aave`);
    expect(init?.method ?? 'GET').toBe('GET');
    expect(rows).toEqual([SAMPLE_ROW]);
  });

  it('listDescriptors throws before any fetch when no filters are given', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okJson([]));
    const api = new KlarityApi(BASE);

    await expect(api.listDescriptors({})).rejects.toThrow(/filter/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('decode POSTs JSON to /decode and returns the DecodeResponse', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okJson(SAMPLE_DECODE));
    const api = new KlarityApi(BASE);

    const body = { chainId: 1, contract: SAMPLE_ROW.contract, calldata: '0x474cf53d' };
    const res = await api.decode(body);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe(`${BASE}/decode`);
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['Content-Type']).toMatch(/application\/json/);
    expect(JSON.parse(init?.body as string)).toEqual(body);
    expect(res).toEqual(SAMPLE_DECODE);
  });

  it('rejects with an error naming the status on a non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(errStatus(500));
    const api = new KlarityApi(BASE);

    await expect(api.listDescriptors({ entityName: 'aave' })).rejects.toThrow(/500/);
  });

  it('rejects with a shape error when an array endpoint returns a non-array', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okJson({ not: 'an array' }));
    const api = new KlarityApi(BASE);

    await expect(api.listDescriptors({ entityName: 'aave' })).rejects.toThrow(/array/i);
  });

  it('getDescriptor GETs the three-segment path and returns a SingleDescriptor', async () => {
    const single: SingleDescriptor = { ...SAMPLE_ROW, $key: 'k1' };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okJson(single));
    const api = new KlarityApi(BASE);

    const res = await api.getDescriptor(1, SAMPLE_ROW.contract, '0x474cf53d');

    const [url] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe(`${BASE}/descriptors/1/${SAMPLE_ROW.contract}/0x474cf53d`);
    expect(res).toEqual(single);
  });
});
