export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface Config {
  arkiv: {
    privateKey: string;
    rpcUrl: string;
    wsUrl: string;
    chainId: number;
    accessKey: string;
  };
  github: {
    token: string;
    botLogin: string;
    upstreamOwner: string;
    upstreamRepo: string;
    webhookSecret: string;
  };
  authorizedWallets: Set<string>;
  pollIntervalMs: number;
  dbPath: string;
  port: number;
  /**
   * Optional EAS attestation wiring. Present only when EAS_CHAIN_ID is set;
   * absent ⇒ the server skips attestation entirely. Holds no secret — the
   * signer is NOT configured here (it is the existing injected Arkiv signer),
   * only the chain selector and an EAS RPC endpoint for reads.
   */
  eas?: {
    chainId: number;
    rpcUrl: string;
  };
}

type Env = Record<string, string | undefined>;

const REQUIRED = [
  'ARKIV_PRIVATE_KEY',
  'ARKIV_RPC_URL',
  'ARKIV_CHAIN_ID',
  'GITHUB_TOKEN',
] as const;

function parseIntOr(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new ConfigError(`Invalid numeric config value: "${value}"`);
  }
  return n;
}

export function loadConfig(env: Env = process.env): Config {
  const missing = REQUIRED.filter((key) => {
    const v = env[key];
    return v === undefined || v.trim() === '';
  });
  if (missing.length > 0) {
    throw new ConfigError(
      `Missing required environment variables: ${missing.join(', ')}`
    );
  }

  const authorizedWallets = new Set(
    (env.AUTHORIZED_WALLETS ?? '')
      .split(',')
      .map((w) => w.trim().toLowerCase())
      .filter((w) => w.length > 0)
  );

  const config: Config = {
    arkiv: {
      privateKey: env.ARKIV_PRIVATE_KEY as string,
      rpcUrl: env.ARKIV_RPC_URL as string,
      wsUrl: env.ARKIV_WS_URL ?? '',
      chainId: parseIntOr(env.ARKIV_CHAIN_ID, 0),
      accessKey: env.ARKIV_ACCESS_KEY ?? '',
    },
    github: {
      token: env.GITHUB_TOKEN as string,
      botLogin: env.GITHUB_BOT_LOGIN ?? '',
      upstreamOwner: env.UPSTREAM_OWNER ?? 'ethereum',
      upstreamRepo: env.UPSTREAM_REPO ?? 'clear-signing-erc7730-registry',
      webhookSecret: env.GITHUB_WEBHOOK_SECRET ?? '',
    },
    authorizedWallets,
    pollIntervalMs: parseIntOr(env.POLL_INTERVAL_MS, 60000),
    dbPath: env.DB_PATH && env.DB_PATH.trim() !== '' ? env.DB_PATH : './klarity.db',
    port: parseIntOr(env.PORT, 3000),
  };

  // EAS wiring is opt-in: only when a chain id is configured. No key is read
  // here — the attester's signer is supplied at wire-up from the existing
  // injected signer, never synthesized from config. When enabled, the chain id
  // must be a positive integer and an rpcUrl must resolve, so a misconfigured
  // attester is never wired pointing at a bogus chain or no endpoint.
  if (env.EAS_CHAIN_ID && env.EAS_CHAIN_ID.trim() !== '') {
    const easChainId = parseIntOr(env.EAS_CHAIN_ID, 0);
    if (!Number.isInteger(easChainId) || easChainId <= 0) {
      throw new ConfigError(
        `EAS_CHAIN_ID must be a positive integer when EAS is enabled, got "${env.EAS_CHAIN_ID}"`,
      );
    }
    const easRpcUrl = env.EAS_RPC_URL ?? env.ARKIV_RPC_URL ?? '';
    if (easRpcUrl.trim() === '') {
      throw new ConfigError(
        'EAS is enabled (EAS_CHAIN_ID set) but no rpcUrl resolves (set EAS_RPC_URL or ARKIV_RPC_URL)',
      );
    }
    config.eas = Object.freeze({ chainId: easChainId, rpcUrl: easRpcUrl });
  }

  Object.freeze(config.arkiv);
  Object.freeze(config.github);
  return Object.freeze(config);
}
