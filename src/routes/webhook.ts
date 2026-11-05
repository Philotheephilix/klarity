import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ServerDeps } from '../server.js';
import { applyChangedFile, type SyncDeps } from '../sync.js';
import { isDescriptorPath } from '../github.js';

/** A GitHub push-event payload (only the fields we consume). */
interface PushPayload {
  commits?: Array<{
    added?: string[];
    removed?: string[];
    modified?: string[];
  }>;
  head_commit?: {
    added?: string[];
    removed?: string[];
    modified?: string[];
  };
  after?: string;
}

/** A changed descriptor file extracted from a push payload. */
interface ChangedFile {
  path: string;
  status: 'added' | 'modified' | 'removed';
}

/**
 * Timing-safe compare of two hex HMAC strings. Returns false on any length
 * mismatch (timingSafeEqual throws on differing lengths) so a crafted short
 * signature can never short-circuit.
 */
function timingSafeHexEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Verify `X-Hub-Signature-256` over the EXACT raw bytes received. The raw body
 * is captured by the application/json content-type parser in buildServer and
 * stashed on `req.rawBody`. Returns true only on a valid sha256 HMAC.
 */
function verifySignature(
  req: FastifyRequest,
  rawBody: Buffer,
  secret: string,
): boolean {
  const header = req.headers['x-hub-signature-256'];
  if (typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const expected =
    'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return timingSafeHexEqual(header, expected);
}

/**
 * Collapse a push payload's per-commit file lists into a de-duplicated set of
 * changed descriptor files. Prefers head_commit when present; otherwise unions
 * all commits. A path appearing as both modified and removed resolves to its
 * last-seen status in commit order (GitHub orders oldest->newest).
 */
function extractChangedFiles(payload: PushPayload): ChangedFile[] {
  const latest = new Map<string, ChangedFile['status']>();
  const groups = payload.commits ?? (payload.head_commit ? [payload.head_commit] : []);
  for (const c of groups) {
    for (const p of c.added ?? []) if (isDescriptorPath(p)) latest.set(p, 'added');
    for (const p of c.modified ?? []) if (isDescriptorPath(p)) latest.set(p, 'modified');
    for (const p of c.removed ?? []) if (isDescriptorPath(p)) latest.set(p, 'removed');
  }
  return [...latest.entries()].map(([path, status]) => ({ path, status }));
}

/**
 * GitHub webhook: drives the SAME ingest path as the T8 poll loop.
 *
 *   1. Verify HMAC over the raw body (timing-safe). Missing/invalid -> 401.
 *   2. Dedupe on X-GitHub-Delivery: a replayed id -> 200 no-op.
 *   3. Run applyChangedFile for each changed descriptor file -> 202.
 */
export function registerWebhookRoute(app: FastifyInstance, deps: ServerDeps): void {
  const { config } = deps;
  // The same deps bundle the poll loop threads through applyChangedFile. ref is
  // the push head sha (getFile reads there), defaulting inside sync if absent.
  const syncDeps: SyncDeps = {
    github: deps.github,
    arkiv: deps.arkiv,
    db: deps.db,
  };

  app.post('/webhooks/github', async (req, reply) => {
    // Harden-at-boot complement: never compute an HMAC under an empty key. An
    // empty secret means the webhook is NOT configured — refuse the route
    // rather than silently accept a signature forgeable under key ''.
    if (config.github.webhookSecret === '') {
      req.log.error('[webhook] refusing request: GITHUB_WEBHOOK_SECRET not configured');
      return reply.code(503).send({ error: 'webhook secret not configured' });
    }

    const rawBody = (req as FastifyRequest & { rawBody?: Buffer }).rawBody;
    if (!rawBody || !verifySignature(req, rawBody, config.github.webhookSecret)) {
      return reply.code(401).send({ error: 'invalid signature' });
    }

    // Dedupe on the delivery id. A replay is an acknowledged no-op (200).
    const deliveryId = req.headers['x-github-delivery'];
    if (typeof deliveryId === 'string' && deliveryId.length > 0) {
      if (deps.db.wasDelivery(deliveryId)) {
        return reply.code(200).send({ status: 'duplicate' });
      }
      deps.db.markDelivery(deliveryId);
    }

    const payload = (req.body ?? {}) as PushPayload;
    const files = extractChangedFiles(payload);
    const ref = typeof payload.after === 'string' ? payload.after : undefined;
    const passDeps: SyncDeps = ref ? { ...syncDeps, ref } : syncDeps;

    for (const file of files) {
      try {
        // Supply the push head (`after`) sha as the per-file sha. The push
        // payload carries no per-file blob sha, so `after` is the ref the files
        // are at — threading it lets include-bearing files hit sync's
        // `skip:includes:<sha>` negative cache (only read/written when sha is
        // defined) instead of re-`getFile`-ing on every delivery.
        await applyChangedFile(
          { path: file.path, status: file.status, sha: ref },
          passDeps,
        );
      } catch (err) {
        // One bad file must not fail the whole delivery; the poll loop re-ingests.
        req.log.warn(
          `[webhook] applyChangedFile failed for ${file.path}: ${(err as Error).message}`,
        );
      }
    }

    return reply.code(202).send({ accepted: files.length });
  });
}
