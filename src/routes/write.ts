import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server.js';
import {
  verifyWrite,
  AuthError,
  type DescriptorWriteMessage,
  type WriteAction,
} from '../auth.js';
import { descriptorHash } from '../hash.js';
import { normalizeDescriptor, type EntityRecord } from '../normalize/normalize.js';

/** The known WriteAction union (mirrors src/auth.ts). */
const KNOWN_ACTIONS: readonly WriteAction[] = ['create', 'update', 'delete'];

/** Shape of the raw POST /descriptors JSON body (types unvalidated/uncoerced). */
interface RawWriteBody {
  descriptor?: unknown;
  message?: {
    descriptorHash?: unknown;
    deadline?: unknown;
    nonce?: unknown;
    action?: unknown;
  };
  signature?: unknown;
  /** Optional explicit registry path + entityKey the client may supply. */
  path?: unknown;
  entityKey?: unknown;
}

/** AuthError.code -> HTTP status. UNAUTHORIZED is 401; the rest are 400. */
function statusForAuthError(err: AuthError): number {
  return err.code === 'UNAUTHORIZED' ? 401 : 400;
}

/**
 * The authoritative signed-write route. ONLY an EF-allowlisted wallet with a
 * valid EIP-712 signature may mutate a mirrored entity AND open an upstream PR.
 *
 * The ROUTE is the parser boundary (T6 handoff): it validates the body shape
 * and coerces deadline/nonce to BigInt BEFORE calling verifyWrite, and
 * validates the recovered `action` is in the known union AFTER.
 */
export function registerWriteRoutes(app: FastifyInstance, deps: ServerDeps): void {
  const { arkiv, github, db, config, attester } = deps;

  app.post('/descriptors', async (req, reply) => {
    const body = (req.body ?? {}) as RawWriteBody;

    // 1. Body-shape validation BEFORE verifyWrite.
    if (
      typeof body.descriptor !== 'object' ||
      body.descriptor === null ||
      typeof body.signature !== 'string' ||
      !body.signature.startsWith('0x') ||
      typeof body.message !== 'object' ||
      body.message === null
    ) {
      return reply.badRequest('invalid request body');
    }
    const rawMsg = body.message;
    if (
      typeof rawMsg.descriptorHash !== 'string' ||
      !rawMsg.descriptorHash.startsWith('0x') ||
      typeof rawMsg.action !== 'string' ||
      rawMsg.deadline === undefined ||
      rawMsg.deadline === null ||
      rawMsg.nonce === undefined ||
      rawMsg.nonce === null
    ) {
      return reply.badRequest('invalid message shape');
    }

    // 2. Coerce deadline/nonce to BigInt. BigInt() throws a raw TypeError on a
    //    non-numeric value — catch it and return 400 (not 500).
    let message: DescriptorWriteMessage;
    try {
      message = {
        descriptorHash: rawMsg.descriptorHash as `0x${string}`,
        deadline: BigInt(rawMsg.deadline as string | number),
        nonce: BigInt(rawMsg.nonce as string | number),
        action: rawMsg.action as WriteAction,
      };
    } catch {
      return reply.badRequest('deadline and nonce must be numeric');
    }

    const descriptor = body.descriptor as Record<string, unknown>;

    // 3. The security gate. Map AuthError by code; any other throw -> 500.
    let signer: string;
    let action: WriteAction;
    try {
      const result = await verifyWrite(
        { descriptor, message, signature: body.signature as `0x${string}` },
        db,
        config,
      );
      signer = result.signer;
      action = result.action;
    } catch (err) {
      if (err instanceof AuthError) {
        return reply
          .code(statusForAuthError(err))
          .send({ error: err.code });
      }
      throw err; // non-AuthError -> Fastify 500 (no internals leaked)
    }

    // 4. Validate the recovered action is in the known union (T6 handoff).
    //    An out-of-union action from an authorized signer -> 400.
    if (!KNOWN_ACTIONS.includes(action)) {
      return reply.badRequest('unknown action');
    }

    const contentHash = descriptorHash(descriptor);

    if (action === 'delete') {
      // Delete needs the entityKey. Accept an explicit body.entityKey, else
      // derive the identity from the descriptor and look up the stored entity.
      let entityKey: `0x${string}` | undefined;
      let path: string | undefined =
        typeof body.path === 'string' ? body.path : undefined;

      if (typeof body.entityKey === 'string' && body.entityKey.startsWith('0x')) {
        entityKey = body.entityKey as `0x${string}`;
      }

      let records: EntityRecord[];
      try {
        records = normalizeRecords(descriptor, path);
      } catch (err) {
        return reply.badRequest((err as Error).message);
      }
      const first = records[0];
      if (first === undefined) {
        return reply.badRequest('descriptor yields no records to delete');
      }
      if (path === undefined) path = first.sourcePath;

      if (entityKey === undefined) {
        const existing = await arkiv.queryOne({
          chainId: first.chainId,
          contract: first.contract,
          selector: first.selector,
        });
        if (existing === null) {
          return reply.notFound('descriptor not found');
        }
        entityKey = existing.$key as `0x${string}`;
      }

      const { txHash } = await arkiv.remove(entityKey);
      const prUrl = await github.openDescriptorPR({
        path,
        descriptor,
        entityKey,
        wallet: signer,
        action,
      });
      return reply.send({ txHash, prUrl });
    }

    // create / update: normalize -> upsert each record -> open ONE PR.
    let records: EntityRecord[];
    try {
      records = normalizeRecords(
        descriptor,
        typeof body.path === 'string' ? body.path : undefined,
      );
    } catch (err) {
      return reply.badRequest((err as Error).message);
    }
    if (records.length === 0) {
      return reply.badRequest('descriptor yields no records');
    }

    let lastEntityKey = '';
    let lastTxHash = '';
    for (const rec of records) {
      const result = await arkiv.upsert(rec, {
        source: 'authorized-write',
        authorizedBy: signer,
        contentHash,
      });
      lastEntityKey = result.entityKey;
      lastTxHash = result.txHash;
    }

    // Optional EF attestation. A configured attester signs an EAS attestation
    // over the content hash; we then stamp the UID onto EVERY mirrored record
    // (the attestation is over the whole descriptor, so each selector's row
    // must carry it). An attestation failure MUST NOT fail the write — the
    // descriptor is already mirrored; attestation is an additive trust signal.
    let attested = false;
    let attestationUID: string | undefined;
    if (attester) {
      let uid: string | undefined;
      let efAttester: string | undefined;
      try {
        const r = await attester.attest(contentHash);
        uid = r.uid;
        efAttester = r.attester;
      } catch {
        uid = undefined; // on-chain attest itself failed — nothing minted
      }
      if (uid !== undefined) {
        // The attestation is live on-chain: hold onto the UID regardless of
        // whether the follow-up row patch succeeds (a patch failure must not
        // discard a real attestation — losing the UID is a false negative).
        attested = true;
        attestationUID = uid;
        try {
          for (const rec of records) {
            const patch = await arkiv.upsert(rec, {
              source: 'authorized-write',
              authorizedBy: signer,
              contentHash,
              attestationUID: uid,
              attester: efAttester,
            });
            lastEntityKey = patch.entityKey;
            lastTxHash = patch.txHash;
          }
        } catch {
          // Row patch failed after a successful on-chain attest. Keep
          // attested:true + the UID; the entityKey/txHash remain the last
          // successful write's pair (set above). Re-stampable later.
        }
      }
    }

    const path =
      typeof body.path === 'string' ? body.path : records[0]!.sourcePath;
    const prUrl = await github.openDescriptorPR({
      path,
      descriptor,
      entityKey: lastEntityKey,
      wallet: signer,
      action,
    });

    return reply.send({
      entityKey: lastEntityKey,
      txHash: lastTxHash,
      prUrl,
      attested,
      ...(attestationUID !== undefined ? { attestationUID } : {}),
    });
  });
}

/**
 * Normalize a POSTed descriptor to EntityRecords. Authoritative writes MUST
 * post already-resolved descriptors: the normalizer's fragment loader is sync
 * but we have no synchronous registry reader here, so an includes-bearing POST
 * is rejected (normalizeDescriptor throws) and surfaced as 400. See Ruling.
 *
 * `path` (when supplied) is the registry path the descriptor normalizes under;
 * otherwise a stable placeholder is used so entityName/sourcePath derive. The
 * authoritative identity (chainId/contract/selector) does not depend on it.
 */
function normalizeRecords(
  descriptor: Record<string, unknown>,
  path: string | undefined,
): EntityRecord[] {
  const sourcePath = path ?? 'registry/authorized-write.json';
  return normalizeDescriptor(descriptor, sourcePath);
}
