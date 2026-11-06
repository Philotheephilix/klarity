import type {
  BrowseFilters,
  DecodeRequest,
  DecodeResponse,
  Descriptor,
  DescriptorWithFormatBlock,
} from './types.js';

export interface KlarityClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  /**
   * Per-request timeout in milliseconds. When set (> 0), each request is raced
   * against an `AbortController` so a slow or hung server can never block the
   * caller indefinitely — the request rejects once the budget elapses. Left
   * undefined there is no client-side timeout (the previous behaviour).
   *
   * This matters for embedders that run inside an event handler which must
   * return promptly: the MetaMask Snap calls `decode` from `onTransaction`, and
   * a fetch that never settles leaves the insight panel stuck in its loading
   * state forever. A bounded timeout turns that hang into a catchable error.
   */
  timeoutMs?: number;
}

/** Thin typed wrapper over the Klarity HTTP API (docs/API.md). */
export class KlarityClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number | undefined;

  constructor(opts: KlarityClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    const f = opts.fetch ?? globalThis.fetch;
    if (!f) throw new Error('KlarityClient: no fetch available; pass one via options.fetch');
    this.fetchImpl = f;
    this.timeoutMs =
      opts.timeoutMs !== undefined && opts.timeoutMs > 0 ? opts.timeoutMs : undefined;
  }

  /** GET /descriptors/:chainId/:contract/:selector — one descriptor with its inlined formatBlock. */
  async getDescriptor(chainId: number, contract: string, selector: string): Promise<DescriptorWithFormatBlock> {
    return this.getJson(`/descriptors/${chainId}/${contract.toLowerCase()}/${selector}`);
  }

  /** GET /descriptors/:chainId/:contract — all formats for a contract. */
  async listByContract(chainId: number, contract: string): Promise<Descriptor[]> {
    return this.getJson(`/descriptors/${chainId}/${contract.toLowerCase()}`);
  }

  /** GET /descriptors?<filters> — filtered browse (at least one filter required server-side). */
  async browse(filters: BrowseFilters): Promise<Descriptor[]> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null) continue;
      params.append(key, key === 'contract' ? String(value).toLowerCase() : String(value));
    }
    const qs = params.toString();
    return this.getJson(`/descriptors${qs ? `?${qs}` : ''}`);
  }

  /** POST /decode — "what am I signing?" for calldata or EIP-712 typed data. */
  async decode(input: DecodeRequest): Promise<DecodeResponse> {
    return this.request('/decode', { method: 'POST', body: JSON.stringify(input), headers: { 'Content-Type': 'application/json' } });
  }

  /** GET /nonce/:address — a fresh candidate nonce for a signed write. */
  async getNonce(address: string): Promise<{ nonce: string }> {
    return this.getJson(`/nonce/${address}`);
  }

  private getJson<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    // Bound the request with an AbortController when a timeout is configured, so
    // a server that accepts the connection but never responds cannot hang the
    // caller. The timer is always cleared, whether the fetch resolves, rejects,
    // or is aborted. A caller-supplied `init.signal` is respected too: if either
    // the caller's signal or our timeout fires, the fetch aborts.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fetchInit = init;
    if (this.timeoutMs !== undefined) {
      const controller = new AbortController();
      timer = setTimeout(() => {
        controller.abort(new Error(`KlarityClient: ${init.method ?? 'GET'} ${path} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      if (init.signal) {
        init.signal.addEventListener('abort', () => controller.abort(init.signal?.reason), {
          once: true,
        });
      }
      fetchInit = { ...init, signal: controller.signal };
    }

    let res: Response;
    try {
      res = await this.fetchImpl(url, fetchInit);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }

    if (!res.ok) {
      let detail = '';
      try {
        detail = await res.text();
      } catch {
        // body already consumed or unavailable; the status alone is enough
      }
      throw new Error(`KlarityClient: ${init.method ?? 'GET'} ${path} failed with ${res.status}${detail ? `: ${detail}` : ''}`);
    }
    return (await res.json()) as T;
  }
}
