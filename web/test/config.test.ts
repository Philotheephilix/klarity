import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'NEXT_PUBLIC_KLARITY_API_BASE';

describe('config', () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env[KEY];
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env[KEY];
    } else {
      process.env[KEY] = original;
    }
    vi.resetModules();
  });

  it('apiBase() returns the env value when set', async () => {
    process.env[KEY] = 'https://api.klarity.test';
    vi.resetModules();
    const { apiBase } = await import('../lib/config');
    expect(apiBase()).toBe('https://api.klarity.test');
  });

  it('apiBase() throws a named error when unset', async () => {
    delete process.env[KEY];
    vi.resetModules();
    const { apiBase } = await import('../lib/config');
    expect(() => apiBase()).toThrow(new RegExp(KEY));
  });

  it('makeApi() returns a KlarityApi bound to the base', async () => {
    process.env[KEY] = 'https://api.klarity.test';
    vi.resetModules();
    const { makeApi } = await import('../lib/config');
    const { KlarityApi: FreshKlarityApi } = await import('../lib/api');
    expect(makeApi()).toBeInstanceOf(FreshKlarityApi);
  });

  it('clientApiBase() returns the same-origin proxy path in the browser', async () => {
    // jsdom defines window, so this exercises the browser branch.
    process.env[KEY] = 'https://api.klarity.test';
    vi.resetModules();
    const { clientApiBase } = await import('../lib/config');
    expect(clientApiBase()).toBe('/klarity-api');
  });

  it('clientApiBase() honours NEXT_PUBLIC_KLARITY_API_PROXY override', async () => {
    process.env[KEY] = 'https://api.klarity.test';
    process.env.NEXT_PUBLIC_KLARITY_API_PROXY = '/proxy-x';
    vi.resetModules();
    const { clientApiBase } = await import('../lib/config');
    expect(clientApiBase()).toBe('/proxy-x');
    delete process.env.NEXT_PUBLIC_KLARITY_API_PROXY;
  });
});
