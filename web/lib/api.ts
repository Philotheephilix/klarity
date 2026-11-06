import type {
  DecodeRequest,
  DecodeResponse,
  DescriptorRow,
  SingleDescriptor,
} from './types';

export const DEFAULT_API_BASE =
  process.env.NEXT_PUBLIC_KLARITY_API_BASE ?? '';

export class KlarityApi {
  private readonly baseUrl: string;

  constructor(baseUrl: string = DEFAULT_API_BASE) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  // GET /descriptors — the backend rejects a filterless query with 400, so we
  // refuse to issue one from the client rather than surface a guaranteed error.
  async listDescriptors(
    filters: Record<string, string | number>,
  ): Promise<DescriptorRow[]> {
    const keys = Object.keys(filters);
    if (keys.length === 0) {
      throw new Error(
        'listDescriptors requires at least one filter; a filterless /descriptors query is rejected by the API.',
      );
    }
    const qs = new URLSearchParams();
    for (const key of keys) {
      qs.set(key, String(filters[key]));
    }
    const data = await this.fetchJson(`/descriptors?${qs.toString()}`);
    return asArray<DescriptorRow>(data, 'listDescriptors');
  }

  async getContract(chainId: number, address: string): Promise<DescriptorRow[]> {
    const data = await this.fetchJson(
      `/descriptors/${chainId}/${encodeURIComponent(address)}`,
    );
    return asArray<DescriptorRow>(data, 'getContract');
  }

  async getDescriptor(
    chainId: number,
    address: string,
    selector: string,
  ): Promise<SingleDescriptor> {
    const data = await this.fetchJson(
      `/descriptors/${chainId}/${encodeURIComponent(address)}/${encodeURIComponent(selector)}`,
    );
    return data as SingleDescriptor;
  }

  async decode(body: DecodeRequest): Promise<DecodeResponse> {
    const data = await this.fetchJson('/decode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return data as DecodeResponse;
  }

  private async fetchJson(path: string, init?: RequestInit): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${path}`, init);
    if (!res.ok) {
      throw new Error(`Klarity API request to ${path} failed with status ${res.status}`);
    }
    return res.json();
  }
}

function asArray<T>(data: unknown, method: string): T[] {
  if (!Array.isArray(data)) {
    throw new Error(`${method} expected an array response but received ${typeof data}`);
  }
  return data as T[];
}
