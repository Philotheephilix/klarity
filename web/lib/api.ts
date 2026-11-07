import type {
  CreateDescriptorRequest,
  CreateDescriptorResponse,
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

  // POST /descriptors — a wallet-signed authoritative write. On success the
  // server mirrors to Arkiv and opens a PR, returning the PR url. On a rejected
  // write (bad hash, expired, unauthorized wallet, replay) the server's JSON
  // `message` is surfaced verbatim so the UI can show WALLET_NOT_AUTHORIZED /
  // HASH_MISMATCH / etc. rather than a generic status.
  async createDescriptor(
    body: CreateDescriptorRequest,
  ): Promise<CreateDescriptorResponse> {
    const data = await this.fetchJson('/descriptors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return data as CreateDescriptorResponse;
  }

  private async fetchJson(path: string, init?: RequestInit): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${path}`, init);
    if (!res.ok) {
      // Keep the status (tests + debugging rely on it) AND, when present, the
      // server's JSON { message | error } so callers see the real reason
      // (e.g. an auth rejection) rather than a bare code.
      let detail = `status ${res.status}`;
      try {
        const body = (await res.json()) as { message?: unknown; error?: unknown };
        const msg = body?.message ?? body?.error;
        if (typeof msg === 'string' && msg.length > 0) {
          detail = `status ${res.status}: ${msg}`;
        }
      } catch {
        // non-JSON error body — keep the status-only detail
      }
      throw new Error(`Klarity API request to ${path} failed with ${detail}`);
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
