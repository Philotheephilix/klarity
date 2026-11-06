import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server.js';
import { descriptorHash } from '../hash.js';

/** The known indexed filter keys a browse query may pass through to Arkiv. */
const BROWSE_FILTER_KEYS = [
  'chainId',
  'contract',
  'selector',
  'kind',
  'intent',
  'entityName',
  'contractName',
  'functionName',
  'owner',
  'sourcePath',
  'source',
  'eip712PrimaryType',
] as const;

type BrowseQuery = Record<string, string | undefined>;

/**
 * An Arkiv column reads back as a `{ type, value }` envelope, and a `u64`'s
 * value is a BigInt — which Fastify's JSON serializer refuses. Unwrap a row
 * into plain JSON: drop the envelope, coerce a u64 BigInt to a number, and
 * strip the internal `body`/`bodyHash` columns (the body is surfaced as a
 * decoded `formatBlock`; bodyHash is an integrity detail, never part of the
 * response). `$key` and any already-plain value pass through unchanged.
 */
type ArkivValue = { type: string; value: unknown };

function isArkivValue(v: unknown): v is ArkivValue {
  return (
    typeof v === 'object' &&
    v !== null &&
    'type' in v &&
    'value' in v &&
    typeof (v as { type: unknown }).type === 'string'
  );
}

/**
 * Coerce a BigInt to the narrowest lossless JSON value: a Number when it fits
 * in the safe-integer range, otherwise a decimal string. Fastify cannot
 * serialize a BigInt, and `Number(bigint)` silently rounds above 2^53-1, so a
 * large u64/u256 must round-trip as a string rather than a corrupted number.
 */
function bigintToJson(n: bigint): number | string {
  return n >= -9007199254740991n && n <= 9007199254740991n ? Number(n) : n.toString();
}

function unwrapValue(v: unknown): unknown {
  if (typeof v === 'bigint') return bigintToJson(v);
  if (isArkivValue(v)) {
    const inner = v.value;
    if (typeof inner === 'bigint') return bigintToJson(inner);
    return inner;
  }
  return v;
}

function unwrapRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(row)) {
    if (key === 'body' || key === 'bodyHash') continue; // internal columns
    out[key] = unwrapValue(val);
  }
  return out;
}

/**
 * Read-only query routes: look up mirrored descriptors by identity, by contract,
 * or by a filtered browse. Also the nonce-suggestion convenience endpoint.
 *
 * All reads go through ArkivClient, which pins `.createdBy(registryWallet)`
 * internally — impostor entities are never returned.
 */
export function registerQueryRoutes(app: FastifyInstance, deps: ServerDeps): void {
  const { arkiv, db } = deps;

  // One format for a (chainId, contract, selector) identity.
  app.get<{ Params: { chainId: string; address: string; selector: string } }>(
    '/descriptors/:chainId/:address/:selector',
    async (req, reply) => {
      const chainId = Number(req.params.chainId);
      if (!Number.isFinite(chainId)) {
        return reply.badRequest('chainId must be numeric');
      }
      const row = await arkiv.queryOneWithBody({
        chainId,
        contract: req.params.address.toLowerCase(),
        selector: req.params.selector,
      });
      if (row === null) {
        return reply.notFound('descriptor not found');
      }
      // A `bytes` column reads back as { type:'bytes', value:<hex string> }.
      // Absent/empty body → return the row as-is (pre-column rows).
      const body = row.body as { type: 'bytes'; value: string } | undefined;
      if (body === undefined || !body.value || body.value === '0x') {
        return unwrapRow(row);
      }
      // Decode hex → UTF-8 → JSON, then verify the stored integrity hash.
      // Any decode/parse failure is a 500, never an unhandled throw.
      let parsed: object;
      try {
        const json = Buffer.from(body.value.slice(2), 'hex').toString('utf8');
        parsed = JSON.parse(json);
      } catch {
        return reply.internalServerError('body decode failed');
      }
      const storedHash = (row.bodyHash as { type: 'str'; value: string } | undefined)
        ?.value;
      if (descriptorHash(parsed) !== storedHash) {
        return reply.internalServerError('body hash mismatch');
      }
      const out = unwrapRow(row);
      out.formatBlock = parsed;
      return out;
    },
  );

  // All formats for a (chainId, contract).
  app.get<{ Params: { chainId: string; address: string } }>(
    '/descriptors/:chainId/:address',
    async (req, reply) => {
      const chainId = Number(req.params.chainId);
      if (!Number.isFinite(chainId)) {
        return reply.badRequest('chainId must be numeric');
      }
      const rows = await arkiv.queryMany({
        chainId,
        contract: req.params.address.toLowerCase(),
      });
      return rows.map(unwrapRow);
    },
  );

  // Filtered browse. Only pass through the known indexed keys; ignore the rest.
  app.get<{ Querystring: BrowseQuery }>('/descriptors', async (req, reply) => {
    const q = req.query;
    const filter: Record<string, string | number> = {};
    for (const key of BROWSE_FILTER_KEYS) {
      const value = q[key];
      if (value === undefined || value === '') continue;
      if (key === 'chainId') {
        const n = Number(value);
        if (!Number.isFinite(n)) {
          return reply.badRequest('chainId must be numeric');
        }
        filter.chainId = n;
      } else if (key === 'contract') {
        filter.contract = value.toLowerCase();
      } else {
        filter[key] = value;
      }
    }
    if (Object.keys(filter).length === 0) {
      return reply.badRequest('at least one filter is required');
    }
    const rows = await arkiv.queryMany(filter);
    return rows.map(unwrapRow);
  });

  // Nonce suggestion. The server stores no next-nonce counter (the Db tracks
  // only consumed (signer,nonce) pairs for replay), so this returns a FRESH
  // candidate the client MAY use — not a binding reservation. verifyWrite's
  // replay guard is the real protection. See Ruling.
  app.get<{ Params: { address: string } }>('/nonce/:address', async (req) => {
    const address = req.params.address.toLowerCase();
    let candidate = BigInt(Date.now());
    // Walk forward until we find a value not already consumed for this signer.
    while (db.isNonceUsed(address, candidate.toString())) {
      candidate += 1n;
    }
    return { nonce: candidate.toString() };
  });
}
