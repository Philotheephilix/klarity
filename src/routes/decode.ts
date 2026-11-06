import type { FastifyInstance } from 'fastify';
import { parseAbiItem, decodeFunctionData, type AbiFunction, type AbiParameter } from 'viem';
import type { ServerDeps } from '../server.js';
import { decodeBody, eip712SelectorOf, encodeType } from './descriptor-body.js';
import { decodePermit, type PermitDecoded } from '../decode/permit.js';

/** 1inch `permitAndCall(bytes permit, bytes action)` selector. */
const PERMIT_AND_CALL_SELECTOR = '0x5816d723';
const PERMIT_AND_CALL_SIGNATURE = 'permitAndCall(bytes permit, bytes action)';

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
  /** Recursively-decoded inner call (1inch permitAndCall `action` bytes). */
  inner?: DecodeResult;
  /** Decoded permit payload (1inch permitAndCall `permit` bytes). */
  permit?: PermitDecoded;
}

/**
 * The response body of a /decode, also used as the shape of a nested `inner`
 * decode. `unresolved` marks an inner call we could not resolve (no descriptor
 * for the inner selector or malformed inner bytes) — rendered honestly, never
 * dropped.
 */
interface DecodeResult {
  signing: Record<string, unknown>;
  fields: SigningField[];
  hiddenFields: SigningField[];
  note: string;
  raw: { calldata?: string; typedData?: unknown };
  functionSignature?: string;
  unresolved?: boolean;
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

/** The all-zero 20-byte address (native asset marker — never emitted as a token). */
const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000';

/** Match an operator path segment: `[0]`, `[-1]`, or the byte-slice `[-20:]`. */
const OP_SEG_RE = /^\[(-?\d+)(:?)\]$/;

/**
 * Take a scalar word (bigint / number / 0x-hex / base-10 string) and return its
 * low 20 bytes as a lowercased `0x…40hex` address — the `[-20:]` byte-slice the
 * 1inch descriptors use to pull a token/pool address out of a packed uint256
 * word. Returns null for any non-scalar shape (honest, never throws).
 */
function lowBytesAddress(v: unknown): string | null {
  let n: bigint;
  try {
    if (typeof v === 'bigint') n = v;
    else if (typeof v === 'number') n = BigInt(v);
    else if (typeof v === 'string') {
      n = v.startsWith('0x') ? BigInt(v) : BigInt(v);
    } else return null;
  } catch {
    return null;
  }
  if (n < 0n) return null;
  // 32-byte word, take the last 20 bytes (40 hex chars).
  const word = n.toString(16).padStart(64, '0');
  if (word.length > 64) return null; // wider than a 32-byte word — not a packed address
  return '0x' + word.slice(-40).toLowerCase();
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
 * Walk a path that MAY end in (or contain) an index / byte-slice operator, over
 * the decoded value tree in lockstep with the ABI parameter tree. Named
 * components map by `AbiParameter.name`; a bare `[]` collapses an array to its
 * element type (a per-element value is the wallet's concern). Supported
 * operators:
 *   `[N]`    — index N into an array value (type → element type).
 *   `[-N]`   — index from the end of an array.
 *   `[-20:]` — the low-20-byte slice of a scalar word → lowercased `0x…` address
 *              (type → "address"). Only `[-20:]` is supported; any other `[-K:]`
 *              slice form → null (honest, no guess).
 * Named-component / bare-`[]` descent (named components, array collapse) is
 * preserved for non-operator segments. Never throws — null on any shape
 * mismatch so the field stays labels-only.
 */
function resolveArgEx(
  segments: string[],
  node: unknown,
  params: readonly AbiParameter[] | undefined,
): ResolvedArg | null {
  let value: unknown = node;
  let abiParams: readonly AbiParameter[] | undefined = params;
  let type = '';

  for (const seg of segments) {
    const op = OP_SEG_RE.exec(seg);
    if (seg === '[]') {
      if (!Array.isArray(value)) return null;
      type = elementType(type);
      value = value.length > 0 ? value[0] : undefined;
      continue;
    }
    if (op) {
      const num = Number(op[1]);
      const isSlice = op[2] === ':';
      if (isSlice) {
        // Only the `[-20:]` low-20-byte form is supported.
        if (op[1] !== '-20') return null;
        const addr = lowBytesAddress(value);
        if (addr === null) return null;
        value = addr;
        type = 'address';
        continue;
      }
      // Numeric index into an array (supports negative-from-end).
      if (!Array.isArray(value)) return null;
      const i = num < 0 ? value.length + num : num;
      if (i < 0 || i >= value.length) return null;
      value = value[i];
      type = elementType(type);
      continue;
    }
    if (abiParams === undefined) return null;
    const idx = abiParams.findIndex((p) => p.name === seg);
    if (idx === -1) return null;
    const param = abiParams[idx]!;
    type = param.type;
    if (Array.isArray(value)) {
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
 * Resolve an ERC-7730 `params.tokenPath` to a concrete lowercased 20-byte token
 * address, or null if it does not resolve to a usable (non-zero) address.
 *
 * Forms: plain / dotted names (`asset`, `order.takerAsset`), index (`path.[0]`),
 * byte-slice (`token.[-20:]`), and the tx-level `@.to` (the callee contract is
 * itself the token). `@.from` / `@.value` are not known server-side → null.
 */
function resolveTokenPath(
  tokenPath: string,
  args: readonly unknown[],
  abiInputs: readonly AbiParameter[] | undefined,
  contract: string,
): string | null {
  if (tokenPath === '@.to') return normalizeAddress(contract);
  const segments = pathSegments(tokenPath);
  if (segments === null || segments.length === 0) return null; // @.from / @.value / empty
  let resolved: ResolvedArg | null;
  try {
    resolved = resolveArgEx(segments, args, abiInputs);
  } catch {
    return null;
  }
  if (resolved === null) return null;
  return normalizeAddress(resolved.value);
}

/**
 * Validate a resolved value as a usable token address: a lowercased `0x…40hex`
 * that is NOT address(0). Returns the lowercased address, or null otherwise —
 * so native / zero / non-address values never become a `params.token`.
 */
function normalizeAddress(v: string): string | null {
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) return null;
  const lower = v.toLowerCase();
  if (lower === ADDRESS_ZERO) return null;
  return lower;
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
  contract: string,
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
    if (segments !== null && segments.length > 0) {
      try {
        const resolved = resolveArgEx(segments, args, abi.inputs);
        if (resolved !== null) {
          field.value = resolved.value;
          field.type = resolved.type;
        }
      } catch {
        // Leave this field labels-only on any unexpected shape error.
      }
    }

    // Resolve an indirect `params.tokenPath` into a concrete `params.token`
    // address for the snap's ERC-20 formatter. Honest: only a resolved, non-zero
    // 20-byte address is emitted; a literal `params.token` already present wins.
    const params = field.params;
    if (
      params &&
      typeof params.tokenPath === 'string' &&
      typeof params.token !== 'string'
    ) {
      try {
        const token = resolveTokenPath(params.tokenPath, args, abi.inputs, contract);
        if (token !== null) field.params = { ...params, token };
      } catch {
        // Leave params.token unset on any unexpected shape error.
      }
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

  /**
   * ABI-decode `calldata` for a known inner `selector` on the same (chainId,
   * contract): look up its descriptor via the body-bearing query, map its
   * fields, and value-decode against its `__signature`. Returns a labels-only
   * result on a hash/body error, an unresolved marker when no descriptor exists
   * or the bytes are malformed. Never throws — the outer route must not 500 on
   * an inner-decode problem.
   */
  async function decodeInnerCall(
    chainId: number,
    contract: string,
    calldata: string,
  ): Promise<DecodeResult> {
    // Malformed inner calldata (no 4-byte selector): honest unknown marker.
    if (!/^0x[0-9a-fA-F]*$/.test(calldata) || calldata.length < 10) {
      const selector = calldata.slice(0, 10).toLowerCase();
      return unresolvedInner(chainId, contract, selector, calldata);
    }
    const selector = calldata.slice(0, 10).toLowerCase();

    let row: Record<string, unknown> | null;
    try {
      row = await arkiv.queryOneWithBody({ chainId, contract, selector });
    } catch {
      return unresolvedInner(chainId, contract, selector, calldata);
    }
    if (row === null) {
      return unresolvedInner(chainId, contract, selector, calldata);
    }

    const bodyResult = decodeBody(row);
    if (!bodyResult.ok) {
      // A body we cannot trust (decode/mismatch) is not safe to present as
      // decoded; fall back to the honest unknown marker rather than 500.
      return unresolvedInner(chainId, contract, selector, calldata);
    }
    return assembleCalldataResult(row, chainId, contract, selector, calldata, bodyResult.formatBlock);
  }

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
    if (!bodyResult.ok && (bodyResult.reason === 'decode' || bodyResult.reason === 'mismatch')) {
      return reply.internalServerError(`descriptor body ${bodyResult.reason}`);
    }
    const formatBlock = bodyResult.ok ? bodyResult.formatBlock : undefined;

    if (decodedFrom === 'eip712') {
      // eip712 has no calldata to unwrap; assemble the labels-only summary.
      return assembleEip712Result(row, chainId, contract, selector, body.typedData, formatBlock);
    }

    // calldata path
    const calldata = body.calldata as string;
    const result = assembleCalldataResult(row, chainId, contract, selector, calldata, formatBlock);

    // --- 1inch permitAndCall unwrapping (depth 1 only) ---
    // Trigger on name OR selector, so an unnamed/renamed wrapper still unwraps.
    const functionName =
      (row.functionName as { value?: string } | undefined)?.value ?? '';
    const isPermitAndCall =
      selector === PERMIT_AND_CALL_SELECTOR || functionName === 'permitAndCall';
    if (isPermitAndCall) {
      await unwrapPermitAndCall(result, chainId, contract, calldata, decodeInnerCall);
    }

    return result;
  });
}

/**
 * Decode the `permit` + `action` of a permitAndCall calldata and attach the
 * decoded permit and recursively-decoded inner call onto `result`'s fields.
 * Fully guarded: any failure leaves `result` as the already-assembled outer
 * decode — the route never throws because of the unwrap.
 *
 * Attachment (per task ruling): `permit` attaches to the field whose `path`
 * ends in `permit`, `inner` to the field whose `path` ends in `action`; if a
 * target field is absent, it attaches to the first field as a fallback so the
 * data is always renderable (never silently dropped).
 */
async function unwrapPermitAndCall(
  result: DecodeResult,
  chainId: number,
  contract: string,
  calldata: string,
  decodeInnerCall: (c: number, k: string, d: string) => Promise<DecodeResult>,
): Promise<void> {
  let permitBytes: string;
  let actionBytes: string;
  try {
    const abi = parseAbiItem(`function ${PERMIT_AND_CALL_SIGNATURE}`);
    if (abi.type !== 'function') return;
    const decoded = decodeFunctionData({ abi: [abi], data: calldata as `0x${string}` });
    const args = (decoded.args ?? []) as readonly unknown[];
    if (typeof args[0] !== 'string' || typeof args[1] !== 'string') return;
    permitBytes = args[0];
    actionBytes = args[1];
  } catch {
    return;
  }

  // Classify + decode the permit; honest unknown on anything unrecognized.
  let permit: PermitDecoded;
  try {
    permit = decodePermit(permitBytes);
  } catch {
    permit = { format: 'unknown', fields: [], raw: permitBytes };
  }

  // Recursively decode the inner action (one level only).
  const inner = await decodeInnerCall(chainId, contract, actionBytes);

  const all = [...result.fields, ...result.hiddenFields];
  const permitField = all.find((f) => endsWithSeg(f.path, 'permit')) ?? all[0];
  const actionField = all.find((f) => endsWithSeg(f.path, 'action')) ?? all[0];
  if (permitField) permitField.permit = permit;
  if (actionField) actionField.inner = inner;
}

/** True if an ERC-7730 path's last dotted segment equals `seg`. */
function endsWithSeg(path: string, seg: string): boolean {
  const parts = path.split('.').filter((s) => s.length > 0);
  return parts[parts.length - 1] === seg;
}

/** An honest "unknown inner call" marker carrying the raw selector + bytes. */
function unresolvedInner(
  chainId: number,
  contract: string,
  selector: string,
  calldata: string,
): DecodeResult {
  return {
    signing: {
      chainId,
      contract,
      selector,
      kind: 'calldata',
      decodedFrom: 'calldata',
      contractName: '',
      functionName: '',
      intent: '',
      interpolatedIntent: null,
      summary: 'Unknown inner call',
    },
    fields: [],
    hiddenFields: [],
    note: 'No clear-signing descriptor for the inner call; only the raw selector is known.',
    raw: { calldata: calldata.toLowerCase() },
    unresolved: true,
  };
}

/**
 * Assemble the DecodeResult for a resolved calldata descriptor row: map the
 * format block's fields, value-decode against the stored `__signature`, and
 * split visible/hidden. Shared by the outer route and the inner recursion.
 */
function assembleCalldataResult(
  row: Record<string, unknown>,
  chainId: number,
  contract: string,
  selector: string,
  calldata: string,
  formatBlock: Record<string, unknown> | undefined,
): DecodeResult {
  const functionName = (row.functionName as { value?: string } | undefined)?.value ?? '';
  const contractName = (row.contractName as { value?: string } | undefined)?.value ?? '';
  const kind = (row.kind as { value?: string } | undefined)?.value ?? '';
  const intent = (row.intent as { value?: string } | undefined)?.value ?? '';

  let fields: SigningField[] = [];
  let interpolatedIntent: string | undefined;
  let bodyIntent: string | undefined;
  let functionSignature = '';
  if (formatBlock) {
    if (Array.isArray(formatBlock.fields)) {
      fields = (formatBlock.fields as FormatField[])
        .map(toSigningField)
        .filter((f): f is SigningField => f !== null);
    }
    if (typeof formatBlock.interpolatedIntent === 'string')
      interpolatedIntent = formatBlock.interpolatedIntent;
    if (typeof formatBlock.intent === 'string') bodyIntent = formatBlock.intent;
    if (typeof formatBlock.__signature === 'string') functionSignature = formatBlock.__signature;
  }

  if (functionSignature) {
    decodeValues(functionSignature, calldata, fields, contract);
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
      decodedFrom: 'calldata',
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
    raw: { calldata: calldata.toLowerCase() },
    ...(functionSignature ? { functionSignature } : {}),
  };
}

/** Assemble the DecodeResult for an eip712 descriptor row (labels-only). */
function assembleEip712Result(
  row: Record<string, unknown>,
  chainId: number,
  contract: string,
  selector: string,
  typedData: unknown,
  formatBlock: Record<string, unknown> | undefined,
): DecodeResult {
  const functionName = (row.functionName as { value?: string } | undefined)?.value ?? '';
  const contractName = (row.contractName as { value?: string } | undefined)?.value ?? '';
  const kind = (row.kind as { value?: string } | undefined)?.value ?? '';
  const intent = (row.intent as { value?: string } | undefined)?.value ?? '';

  let fields: SigningField[] = [];
  let interpolatedIntent: string | undefined;
  let bodyIntent: string | undefined;
  if (formatBlock) {
    if (Array.isArray(formatBlock.fields)) {
      fields = (formatBlock.fields as FormatField[])
        .map(toSigningField)
        .filter((f): f is SigningField => f !== null);
    }
    if (typeof formatBlock.interpolatedIntent === 'string')
      interpolatedIntent = formatBlock.interpolatedIntent;
    if (typeof formatBlock.intent === 'string') bodyIntent = formatBlock.intent;
  }

  const shown = fields.filter((f) => !f.hidden);
  const hidden = fields.filter((f) => f.hidden);

  return {
    signing: {
      chainId,
      contract,
      selector,
      kind,
      decodedFrom: 'eip712',
      contractName,
      functionName,
      intent: bodyIntent || intent,
      interpolatedIntent: interpolatedIntent ?? null,
      summary: interpolatedIntent || bodyIntent || intent || functionName || 'Unknown action',
    },
    fields: shown,
    hiddenFields: hidden,
    note: 'Labels and intent come from the ERC-7730 descriptor. Argument values are not ABI-decoded.',
    raw: { typedData },
  };
}
