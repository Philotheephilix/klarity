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

  Object.freeze(config.arkiv);
  Object.freeze(config.github);
  return Object.freeze(config);
}
