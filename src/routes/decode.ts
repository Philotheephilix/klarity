import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server.js';
import { decodeBody, eip712SelectorOf, encodeType } from './descriptor-body.js';

/**
 * A single field of the clear-signing breakdown. `label`/`format`/`path` come
 * straight from the ERC-7730 format block; `hidden` surfaces the descriptor's
 * `visible: "never"` (a field the wallet is told not to show the user).
 */
interface SigningField {
  label: string;
  path: string;
  format?: string;
  hidden: boolean;
  params?: Record<string, unknown>;
}

/** Raw POST /decode body (types unvalidated until the handler checks them). */
interface RawDecodeBody {
  chainId?: unknown;
  contract?: unknown;
  calldata?: unknown;
  typedData?: {
    primaryType?: unknown;
    types?: unknown;
    message?: unknown;
  };
  /** Optional explicit 4-byte selector override (escape hatch for odd eip712 keys). */
  selector?: unknown;
}

/** A format-block field entry, loosely typed as read from stored JSON. */
interface FormatField {
  label?: unknown;
  path?: unknown;
  format?: unknown;
  visible?: unknown;
  params?: unknown;
}

/** 4-byte selector regex: `0x` + exactly 8 hex chars. */
const SELECTOR_RE = /^0x[0-9a-fA-F]{8}$/;

/** Map one raw format-block field to a SigningField, dropping malformed entries. */
function toSigningField(f: FormatField): SigningField | null {
  if (typeof f.label !== 'string' || typeof f.path !== 'string') return null;
  const hidden = f.visible === 'never';
  return {
    label: f.label,
    path: f.path,
    ...(typeof f.format === 'string' ? { format: f.format } : {}),
    hidden,
    ...(typeof f.params === 'object' && f.params !== null
      ? { params: f.params as Record<string, unknown> }
      : {}),
  };
}

/**
 * Clear-signing decode route. A wallet posts the call it is about to sign —
 * either raw `calldata` or an EIP-712 `typedData` payload — and gets back a
 * human-readable account of what it means, drawn from the mirrored ERC-7730
 * descriptor: the intent, the interpolated intent sentence, and every labeled
 * field with its format and visibility.
 *
 * This is a LABELS-only decode: Klarity does not store parameter ABI types, so
 * the response names what each field means (and whether the wallet should show
 * it) but does not decode concrete argument values out of the calldata.
 */
export function registerDecodeRoute(app: FastifyInstance, deps: ServerDeps): void {
  const { arkiv } = deps;

  app.post('/decode', async (req, reply) => {
    const body = (req.body ?? {}) as RawDecodeBody;

    // --- chainId + contract (shared by both input modes) ---
    const chainId = Number(body.chainId);
    if (!Number.isFinite(chainId)) {
      return reply.badRequest('chainId must be numeric');
    }
    if (typeof body.contract !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(body.contract)) {
      return reply.badRequest('contract must be a 0x-prefixed 20-byte address');
    }
    const contract = body.contract.toLowerCase();

    // --- derive the 4-byte selector from whichever input was supplied ---
    let selector: string;
    let decodedFrom: 'calldata' | 'eip712';
    if (typeof body.calldata === 'string') {
      const cd = body.calldata;
      if (!/^0x[0-9a-fA-F]*$/.test(cd) || cd.length < 10) {
        return reply.badRequest('calldata must be 0x-prefixed hex with a 4-byte selector');
      }
      selector = cd.slice(0, 10).toLowerCase();
      decodedFrom = 'calldata';
    } else if (body.typedData && typeof body.typedData === 'object') {
      const { primaryType, types } = body.typedData;
      if (typeof body.selector === 'string' && SELECTOR_RE.test(body.selector)) {
        selector = body.selector.toLowerCase();
      } else if (
        typeof primaryType === 'string' &&
        typeof types === 'object' &&
        types !== null
      ) {
        const encoded = encodeType(
          primaryType,
          types as Record<string, { name: string; type: string }[]>,
        );
        if (encoded === null) {
          return reply.badRequest('typedData.primaryType is not present in typedData.types');
        }
        selector = eip712SelectorOf(encoded);
      } else {
        return reply.badRequest(
          'typedData requires primaryType and types (or an explicit selector)',
        );
      }
      decodedFrom = 'eip712';
    } else {
      return reply.badRequest('provide either calldata or typedData');
    }

    // --- look up the descriptor and decode its body ---
    const row = await arkiv.queryOneWithBody({ chainId, contract, selector });
    if (row === null) {
      return reply.notFound(
        `no clear-signing descriptor for (${chainId}, ${contract}, ${selector})`,
      );
    }
    const bodyResult = decodeBody(row);

    const functionName = (row.functionName as { value?: string } | undefined)?.value ?? '';
    const contractName = (row.contractName as { value?: string } | undefined)?.value ?? '';
    const kind = (row.kind as { value?: string } | undefined)?.value ?? '';
    const intent = (row.intent as { value?: string } | undefined)?.value ?? '';

    // Fields + the interpolated sentence live only in the format block. A
    // pre-body row (no body stored) still yields the summary from the columns.
    let fields: SigningField[] = [];
    let interpolatedIntent: string | undefined;
    let bodyIntent: string | undefined;
    if (bodyResult.ok) {
      const fb = bodyResult.formatBlock;
      if (Array.isArray(fb.fields)) {
        fields = (fb.fields as FormatField[])
          .map(toSigningField)
          .filter((f): f is SigningField => f !== null);
      }
      if (typeof fb.interpolatedIntent === 'string') interpolatedIntent = fb.interpolatedIntent;
      if (typeof fb.intent === 'string') bodyIntent = fb.intent;
    } else if (bodyResult.reason === 'decode' || bodyResult.reason === 'mismatch') {
      return reply.internalServerError(`descriptor body ${bodyResult.reason}`);
    }

    const shown = fields.filter((f) => !f.hidden);
    const hidden = fields.filter((f) => f.hidden);

    return {
      signing: {
        chainId,
        contract,
        selector,
        kind,
        decodedFrom,
        contractName,
        functionName,
        intent: bodyIntent || intent,
        interpolatedIntent: interpolatedIntent ?? null,
        summary: interpolatedIntent || bodyIntent || intent || functionName || 'Unknown action',
      },
      fields: shown,
      hiddenFields: hidden,
      note:
        'Labels and intent come from the ERC-7730 descriptor. Argument values are not ABI-decoded.',
      raw:
        decodedFrom === 'calldata'
          ? { calldata: (body.calldata as string).toLowerCase() }
          : { typedData: body.typedData },
    };
  });
}
