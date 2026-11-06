import type { FastifyInstance } from 'fastify';
import { parseAbiItem, decodeFunctionData, type AbiFunction, type AbiParameter } from 'viem';
import type { ServerDeps } from '../server.js';
import { decodeBody, eip712SelectorOf, encodeType } from './descriptor-body.js';

/**
 * A single field of the clear-signing breakdown. `label`/`format`/`path` come
 * straight from the ERC-7730 format block; `hidden` surfaces the descriptor's
 * `visible: "never"` (a field the wallet is told not to show the user).
 *
 * `value`/`type` are present only when the calldata was ABI-decoded and the
 * field's `path` resolved to a concrete decoded argument. `value` is the
 * canonical string form (base-10 for integers, checksummed hex for addresses,
 * 0x-hex for bytes); decimal/token formatting is the wallet's job.
 */
interface SigningField {
  label: string;
  path: string;
  format?: string;
  hidden: boolean;
  params?: Record<string, unknown>;
  value?: string;
  type?: string;
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

/** A resolved (value, type) for one ERC-7730 field path. */
interface ResolvedArg {
  value: string;
  type: string;
}

/**
 * Canonical string form of a single decoded ABI value, per the task rulings:
 * - bigint / number -> base-10 string
 * - boolean          -> "true"/"false"
 * - string (address / bytes / string) -> as-is (viem returns addresses
 *   checksummed and bytes as 0x-hex)
 * Objects/arrays are not leaf values and are never stringified here.
 */
function stringifyLeaf(v: unknown): string | null {
  switch (typeof v) {
    case 'bigint':
      return v.toString();
    case 'number':
      return String(v);
    case 'boolean':
      return v ? 'true' : 'false';
    case 'string':
      return v;
    default:
      return null;
  }
}

/** Strip a trailing array-bracket run from an ABI type, e.g. `uint256[]` -> `uint256`. */
function elementType(t: string): string {
  return t.replace(/(\[\d*\])+$/, '');
}

/**
 * Split an ERC-7730 calldata path into segments, dropping the optional `#.`
 * (eip712 message) / `@.` (tx-level) root markers. Tx-level paths (`@.value`,
 * `@.from`, `@.to`) are NOT calldata arguments, so those resolve to null.
 *
 * `"amount"`                  -> ["amount"]
 * `"baseRequest.deadLine"`    -> ["baseRequest","deadLine"]
 * `"paths.[].assets"`         -> ["paths","[]","assets"]
 * `"@.value"`                 -> null (tx-level, not an arg)
 */
function pathSegments(path: string): string[] | null {
  if (path.startsWith('@.') || path === '@') return null;
  const body = path.startsWith('#.') ? path.slice(2) : path;
  return body.split('.').filter((s) => s.length > 0);
}

/**
 * Walk one path through the decoded value tree in lockstep with the ABI
 * parameter tree, resolving to a leaf (value, type). Named components map by
 * `AbiParameter.name`; `[]` descends into an array's element type (collapsing
 * the whole array to its element type — a per-element value is the wallet's
 * concern). Returns null if the path does not resolve to a leaf (shape
 * mismatch, missing name, or a non-leaf endpoint) — honesty over guessing.
 */
function resolveArg(
  segments: string[],
  node: unknown,
  params: readonly AbiParameter[] | undefined,
): ResolvedArg | null {
  let value: unknown = node;
  let abiParams: readonly AbiParameter[] | undefined = params;
  let type = '';

  for (const seg of segments) {
    if (seg === '[]') {
      // Descend into an array: collapse to the element type, keep the first
      // element as a representative value if present.
      if (!Array.isArray(value)) return null;
      type = elementType(type);
      value = value.length > 0 ? value[0] : undefined;
      // abiParams for a tuple[] element is the tuple's components.
      continue;
    }
    if (abiParams === undefined) return null;
    const idx = abiParams.findIndex((p) => p.name === seg);
    if (idx === -1) return null;
    const param = abiParams[idx]!;
    type = param.type;
    if (Array.isArray(value)) {
      // viem returns tuples as arrays positionally, structs as objects. Handle
      // both: positional array indexed by param position.
      value = value[idx];
    } else if (value !== null && typeof value === 'object') {
      value = (value as Record<string, unknown>)[seg];
    } else {
      return null;
    }
    abiParams = (param as { components?: readonly AbiParameter[] }).components;
  }

  const leaf = stringifyLeaf(value);
  if (leaf === null || type === '') return null;
  return { value: leaf, type };
}

/**
 * ABI-decode the calldata against the stored (name-bearing) function signature
 * and map each field's `path` onto a decoded (value, type). Never throws: any
 * parse/decode failure yields an empty map, leaving the response labels-only.
 */
function decodeValues(
  functionSignature: string,
  calldata: string,
  fields: SigningField[],
): void {
  let abi: AbiFunction;
  try {
    const item = parseAbiItem(`function ${functionSignature}`);
    if (item.type !== 'function') return;
    abi = item;
  } catch {
    return;
  }

  let args: readonly unknown[];
  try {
    const decoded = decodeFunctionData({ abi: [abi], data: calldata as `0x${string}` });
    args = (decoded.args ?? []) as readonly unknown[];
  } catch {
    return;
  }

  for (const field of fields) {
    const segments = pathSegments(field.path);
    if (segments === null || segments.length === 0) continue;
    try {
      const resolved = resolveArg(segments, args, abi.inputs);
      if (resolved !== null) {
        field.value = resolved.value;
        field.type = resolved.type;
      }
    } catch {
      // Leave this field labels-only on any unexpected shape error.
    }
  }
}

/**
 * Clear-signing decode route. A wallet posts the call it is about to sign —
 * either raw `calldata` or an EIP-712 `typedData` payload — and gets back a
 * human-readable account of what it means, drawn from the mirrored ERC-7730
 * descriptor: the intent, the interpolated intent sentence, and every labeled
 * field with its format and visibility.
 *
 * When the call is raw `calldata` and the descriptor carries a function
 * signature, each field's `path` is additionally resolved to its concrete
 * ABI-decoded argument (`value`/`type`). This stays best-effort: any decode
 * failure (missing/garbled signature, path that does not resolve) leaves the
 * affected fields labels-only — the route never fails because of it.
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
    const functionSignature =
      (row.functionSignature as { value?: string } | undefined)?.value ?? '';

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

    // ABI value-decode (calldata only). Populates `value`/`type` on the fields
    // whose `path` resolves to a decoded argument. Guarded end-to-end: any
    // failure leaves the fields labels-only — the route never 500s on a decode
    // problem.
    if (decodedFrom === 'calldata' && functionSignature && typeof body.calldata === 'string') {
      decodeValues(functionSignature, body.calldata, fields);
    }
    const valuesPresent = fields.some((f) => f.value !== undefined);

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
        ...(functionSignature ? { functionSignature } : {}),
        intent: bodyIntent || intent,
        interpolatedIntent: interpolatedIntent ?? null,
        summary: interpolatedIntent || bodyIntent || intent || functionName || 'Unknown action',
      },
      fields: shown,
      hiddenFields: hidden,
      note: valuesPresent
        ? 'Labels and intent come from the ERC-7730 descriptor; argument values are ABI-decoded from the calldata.'
        : 'Labels and intent come from the ERC-7730 descriptor. Argument values are not ABI-decoded.',
      raw:
        decodedFrom === 'calldata'
          ? { calldata: (body.calldata as string).toLowerCase() }
          : { typedData: body.typedData },
    };
  });
}
