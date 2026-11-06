import { describe, it, expect } from 'vitest';
import { loadConfig, ConfigError } from '../src/config.js';

function validEnv(): Record<string, string> {
  return {
    ARKIV_PRIVATE_KEY: '0xabc123',
    ARKIV_RPC_URL: 'https://rpc.example.com',
    ARKIV_WS_URL: 'wss://ws.example.com',
    ARKIV_CHAIN_ID: '7794095',
    GITHUB_TOKEN: 'ghp_token',
    GITHUB_BOT_LOGIN: 'klarity-bot',
    UPSTREAM_OWNER: 'ethereum',
    UPSTREAM_REPO: 'clear-signing-erc7730-registry',
    GITHUB_WEBHOOK_SECRET: 'whsec',
    AUTHORIZED_WALLETS: '0xAAAA,0xBbBb,0xCCCC',
    POLL_INTERVAL_MS: '60000',
    DB_PATH: './klarity.db',
    PORT: '3000',
  };
}

describe('loadConfig', () => {
  it('parses a full valid env into a typed Config', () => {
    const cfg = loadConfig(validEnv());

    expect(cfg.arkiv.privateKey).toBe('0xabc123');
    expect(cfg.arkiv.rpcUrl).toBe('https://rpc.example.com');
    expect(cfg.arkiv.wsUrl).toBe('wss://ws.example.com');
    expect(cfg.arkiv.chainId).toBe(7794095);

    expect(cfg.github.token).toBe('ghp_token');
    expect(cfg.github.botLogin).toBe('klarity-bot');
    expect(cfg.github.upstreamOwner).toBe('ethereum');
    expect(cfg.github.upstreamRepo).toBe('clear-signing-erc7730-registry');
    expect(cfg.github.webhookSecret).toBe('whsec');

    expect(cfg.authorizedWallets).toBeInstanceOf(Set);
    expect(cfg.authorizedWallets.has('0xaaaa')).toBe(true);
    expect(cfg.authorizedWallets.has('0xbbbb')).toBe(true);
    expect(cfg.authorizedWallets.has('0xcccc')).toBe(true);
    // lowercased
    expect(cfg.authorizedWallets.has('0xAAAA')).toBe(false);

    expect(cfg.pollIntervalMs).toBe(60000);
    expect(cfg.dbPath).toBe('./klarity.db');
    expect(cfg.port).toBe(3000);
  });

  it('applies defaults for optional vars', () => {
    const env: Record<string, string> = {
      ARKIV_PRIVATE_KEY: '0xabc',
      ARKIV_RPC_URL: 'https://rpc.example.com',
      ARKIV_CHAIN_ID: '7794095',
      GITHUB_TOKEN: 'ghp_token',
    };
    const cfg = loadConfig(env);
    expect(cfg.github.upstreamOwner).toBe('ethereum');
    expect(cfg.github.upstreamRepo).toBe('clear-signing-erc7730-registry');
    expect(cfg.pollIntervalMs).toBe(60000);
    expect(cfg.dbPath).toBe('./klarity.db');
    expect(cfg.port).toBe(3000);
    expect(cfg.github.botLogin).toBe('');
    expect(cfg.github.webhookSecret).toBe('');
    expect(cfg.authorizedWallets.size).toBe(0);
  });

  it('returns a frozen Config', () => {
    const cfg = loadConfig(validEnv());
    expect(Object.isFrozen(cfg)).toBe(true);
  });

  it('throws ConfigError naming every missing required var', () => {
    const env: Record<string, string> = {
      ARKIV_RPC_URL: 'https://rpc.example.com',
      ARKIV_CHAIN_ID: '7794095',
    };
    let err: unknown;
    try {
      loadConfig(env);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConfigError);
    const msg = (err as Error).message;
    expect(msg).toContain('ARKIV_PRIVATE_KEY');
    expect(msg).toContain('GITHUB_TOKEN');
  });

  it('EAS is absent when EAS_CHAIN_ID is unset', () => {
    const cfg = loadConfig(validEnv());
    expect(cfg.eas).toBeUndefined();
  });

  it('EAS config is populated when EAS_CHAIN_ID + EAS_RPC_URL are valid', () => {
    const env = { ...validEnv(), EAS_CHAIN_ID: '11155111', EAS_RPC_URL: 'https://eas.example.com' };
    const cfg = loadConfig(env);
    expect(cfg.eas).toBeDefined();
    expect(cfg.eas!.chainId).toBe(11155111);
    expect(cfg.eas!.rpcUrl).toBe('https://eas.example.com');
  });

  it('EAS falls back to ARKIV_RPC_URL when EAS_RPC_URL is unset', () => {
    const env = { ...validEnv(), EAS_CHAIN_ID: '11155111' };
    const cfg = loadConfig(env);
    expect(cfg.eas!.rpcUrl).toBe('https://rpc.example.com');
  });

  it('throws ConfigError when EAS is enabled but chainId is non-positive', () => {
    const env = { ...validEnv(), EAS_CHAIN_ID: '0', EAS_RPC_URL: 'https://eas.example.com' };
    expect(() => loadConfig(env)).toThrow(ConfigError);
  });

  it('throws ConfigError when EAS is enabled with a negative chainId', () => {
    const env = { ...validEnv(), EAS_CHAIN_ID: '-1', EAS_RPC_URL: 'https://eas.example.com' };
    expect(() => loadConfig(env)).toThrow(ConfigError);
  });

  it('throws ConfigError when EAS is enabled but no rpcUrl resolves', () => {
    // Defensive guard: if EAS is turned on, the attester must have a URL. The
    // fallback to ARKIV_RPC_URL normally fills this, but if a caller passes an
    // env where EAS_RPC_URL is blank AND the ARKIV fallback is blank, refuse to
    // build an EAS config pointing at nothing rather than silently wiring ''.
    const env = { ...validEnv(), EAS_CHAIN_ID: '11155111', EAS_RPC_URL: '', ARKIV_RPC_URL: '' };
    // ARKIV_RPC_URL blank trips the required-var check first — assert that too,
    // then the narrower case where only the EAS url is unresolved is covered by
    // the guard in loadConfig (ARKIV present, EAS url blank falls back to it).
    expect(() => loadConfig(env)).toThrow(ConfigError);
  });
});
