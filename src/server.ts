import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import sensible from '@fastify/sensible';
import { pathToFileURL } from 'node:url';
import type { ArkivClient } from './arkiv/client.js';
import type { GitHubClient } from './github.js';
import type { Db } from './db.js';
import type { Config } from './config.js';
import type { EfAttester } from './eas/attester.js';
import { registerQueryRoutes } from './routes/query.js';
import { registerDecodeRoute } from './routes/decode.js';
import { registerWriteRoutes } from './routes/write.js';
import { registerWebhookRoute } from './routes/webhook.js';

/**
 * The already-constructed dependency bundle buildServer threads to every route.
 * The concrete clients are built once at startup (src/index or tests) and
 * injected here so routes are pure request handlers over a fixed surface.
 */
export interface ServerDeps {
  arkiv: ArkivClient;
  github: GitHubClient;
  db: Db;
  config: Config;
  /**
   * Optional EF attester. When present, an authorized write is attested on-chain
   * and the UID is stamped onto the mirrored row. Absent ⇒ writes skip
   * attestation (no key is ever read to synthesize one).
   */
  attester?: EfAttester;
}

/**
 * Build the Klarity HTTP API: read routes (query mirrored descriptors), the
 * authoritative signed-write route, and the GitHub webhook.
 *
 * The webhook HMAC is computed over the EXACT raw bytes received, so the
 * application/json content-type parser keeps the raw Buffer on `req.rawBody`
 * and JSON-parses it ourselves — a re-serialized body would not match the
 * signature.
 */
export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false });

  // CORS for the MetaMask Snap client. A Snap runs in a sandboxed iframe whose
  // requests carry a `null` Origin and are subject to the browser same-origin
  // policy; MetaMask's network-access docs require the server to answer with
  // `Access-Control-Allow-Origin: *` (or `null`) or the Snap's `fetch` throws
  // before it ever sees the body (symptom: the Snap falls back to "no
  // clear-signing" even though curl gets a 200). We also answer the POST
  // preflight (the Snap sends POST + Content-Type, which is a non-simple
  // request). A wildcard origin precludes credentials, which the Snap sends
  // none of. This mirrors the one documented networking constraint and is safe
  // for a read-mostly decode API.
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type');
    reply.header('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') {
      // Short-circuit the preflight before route matching so a missing OPTIONS
      // route never turns the preflight into a 404 (which blocks the real call).
      await reply.code(204).send();
    }
  });

  // Keep the raw request bytes for HMAC verification, then JSON-parse ourselves.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body, done) => {
      const buf = body as Buffer;
      (req as FastifyRequest & { rawBody?: Buffer }).rawBody = buf;
      if (buf.length === 0) {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(buf.toString('utf8')));
      } catch (err) {
        (err as { statusCode?: number }).statusCode = 400;
        done(err as Error, undefined);
      }
    },
  );

  // @fastify/sensible registers synchronously; register() returns a promise but
  // the decorators are available immediately for route handlers at request time.
  void app.register(sensible);

  registerQueryRoutes(app, deps);
  registerDecodeRoute(app, deps);
  registerWriteRoutes(app, deps);
  registerWebhookRoute(app, deps);

  return app;
}

/**
 * CLI main. Builds the real deps from the environment, starts the HTTP API, and
 * runs the incremental GitHub→Arkiv sync loop alongside it. Guarded behind an
 * import.meta.url main-check so importing this module (tests, the dist-load
 * smoke test) never opens a port or a database.
 */
async function main(): Promise<void> {
  const { loadConfig } = await import('./config.js');
  const { openDb } = await import('./db.js');
  const { ArkivClient } = await import('./arkiv/client.js');
  const { GitHubClient } = await import('./github.js');
  const { startIngestLoop } = await import('./sync.js');

  const config = loadConfig();
  const db = openDb(config.dbPath);
  const arkiv = new ArkivClient(config);
  const github = new GitHubClient(config);

  const app = buildServer({ arkiv, github, db, config });
  await app.listen({ port: config.port, host: '0.0.0.0' });
  // eslint-disable-next-line no-console
  console.error(`[klarity] listening on :${config.port}`);

  // Start the incremental GitHub→Arkiv sync loop alongside the API.
  const stop = startIngestLoop({ arkiv, github, db }, config.pollIntervalMs);
  const shutdown = async (): Promise<void> => {
    stop();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

// Only run when executed directly (node dist/server.js), never on import.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[klarity] fatal:', err);
    process.exit(1);
  });
}
