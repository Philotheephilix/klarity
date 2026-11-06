import sha3 from 'js-sha3';
import { canonicalSignature, selectorOf } from './selector.js';
import { inlineRefs } from './refs.js';
import { resolveIncludes, type LoadFragment } from './includes.js';
import type { EntityRecord } from './types.js';

const { keccak256 } = sha3;

export type { EntityRecord } from './types.js';

/**
 * Options the caller injects so the normalizer stays I/O-free. When a
 * descriptor uses `includes`, the caller provides a `loadFragment` reader and
 * the `fromPath` the descriptor was loaded from (used to resolve relative
 * include paths). Both are optional for descriptors with no `includes`.
 */
export interface NormalizeOptions {
  loadFragment?: LoadFragment;
  fromPath?: string;
}

interface Deployment {
  chainId: number;
  address: string;
}

/**
 * Turn one ERC-7730 descriptor into many flat, self-contained EntityRecords:
 * one per (deployment × format key). Includes are deep-merged and `$ref`
 * definition pointers are inlined first, so each record's `formatBlock` is
 * self-contained (no dangling `$ref`, no external lookup needed).
 */
export function normalizeDescriptor(
  doc: Record<string, unknown>,
  sourcePath: string,
  opts: NormalizeOptions = {},
): EntityRecord[] {
  // 1. Resolve includes (if any) into a complete descriptor.
  let resolved = doc;
  if (typeof doc['includes'] === 'string') {
    if (!opts.loadFragment || !opts.fromPath) {
      throw new Error(
        `descriptor at ${sourcePath} uses includes but no loadFragment/fromPath was provided`,
      );
    }
    resolved = resolveIncludes(doc, opts.loadFragment, opts.fromPath);
  }

  // 2. Inline $ref definition pointers across the whole doc.
  resolved = inlineRefs(resolved);

  const schemaVersion = typeof resolved['$schema'] === 'string' ? (resolved['$schema'] as string) : '';
  const metadata = asObject(resolved['metadata']);
  const owner = typeof metadata['owner'] === 'string' ? (metadata['owner'] as string) : '';
  const entityName = deriveEntityName(sourcePath);

  const context = asObject(resolved['context']);
  const display = asObject(resolved['display']);
  const formats = asObject(display['formats']);
  const formatKeys = Object.keys(formats);

  // 3. Determine kind + deployments.
  const contractCtx = asObject(context['contract']);
  const eip712Ctx = asObject(context['eip712']);
  let kind: 'calldata' | 'eip712';
  let deployments: Deployment[];
  if (context['contract'] !== undefined) {
    kind = 'calldata';
    deployments = asDeployments(contractCtx['deployments']);
  } else if (context['eip712'] !== undefined) {
    kind = 'eip712';
    deployments = asDeployments(eip712Ctx['deployments']);
  } else {
    throw new Error(`descriptor at ${sourcePath} has no contract/eip712 context`);
  }

  const contractName = deriveContractName(context, metadata);

  // 4. Flatten per deployment × per format key.
  const records: EntityRecord[] = [];
  for (const deployment of deployments) {
    for (const key of formatKeys) {
      const formatBlock = asObject(formats[key]);
      const intent = typeof formatBlock['intent'] === 'string' ? (formatBlock['intent'] as string) : '';

      if (kind === 'calldata') {
        // Persist the raw, name-bearing format-block key inside the body under a
        // reserved field. ERC-7730 field paths reference parameters by NAME, so
        // the name-stripped `functionSignature` column cannot resolve them; the
        // body blob (non-indexed bytes, ~129.5KB) holds the full key without
        // hitting the 128-byte str cap. Spread into a fresh object so the shared
        // resolved-doc format block is not mutated.
        records.push({
          chainId: deployment.chainId,
          contract: deployment.address.toLowerCase(),
          selector: selectorOf(key),
          functionName: nameOf(key),
          functionSignature: canonicalSignature(key),
          kind,
          intent,
          entityName,
          contractName,
          owner,
          sourcePath,
          schemaVersion,
          formatBlock: { ...formatBlock, __signature: key },
        });
      } else {
        // eip712: the format key IS the primary type's type-encoding string.
        // selector = first 4 bytes of the EIP-712 typeHash of the primary type
        // (keccak256 of the raw type-encoding key — names preserved, as EIP-712
        // encodeType requires). Keeps the `selector` column non-null + uniform.
        records.push({
          chainId: deployment.chainId,
          contract: deployment.address.toLowerCase(),
          selector: eip712Selector(key),
          functionName: key,
          functionSignature: key,
          kind,
          intent,
          entityName,
          contractName,
          owner,
          sourcePath,
          eip712PrimaryType: key,
          schemaVersion,
          formatBlock,
        });
      }
    }
  }
  return records;
}

/** EIP-712 selector: first 4 bytes of keccak256 of the primary-type encoding. */
function eip712Selector(primaryTypeKey: string): string {
  return `0x${keccak256(primaryTypeKey).slice(0, 8)}`;
}

/** The bare function/type name before the first `(`. */
function nameOf(key: string): string {
  const i = key.indexOf('(');
  return (i === -1 ? key : key.slice(0, i)).trim();
}

/** Registry org directory from the source path: "registry/aave/x.json" -> "aave". */
function deriveEntityName(sourcePath: string): string {
  const parts = sourcePath.split('/').filter(Boolean);
  const i = parts.indexOf('registry');
  if (i !== -1 && parts.length > i + 1) return parts[i + 1];
  // fallback: parent directory of the file
  return parts.length >= 2 ? parts[parts.length - 2] : '';
}

/**
 * Contract name shared by a descriptor's deployments. Prefer context.$id
 * (the ERC-7730 contract identifier), else metadata.info.legalName, else "".
 */
function deriveContractName(
  context: Record<string, unknown>,
  metadata: Record<string, unknown>,
): string {
  if (typeof context['$id'] === 'string') return context['$id'] as string;
  const info = asObject(metadata['info']);
  if (typeof info['legalName'] === 'string') return info['legalName'] as string;
  return '';
}

function asObject(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function asDeployments(v: unknown): Deployment[] {
  if (!Array.isArray(v)) return [];
  const out: Deployment[] = [];
  for (const d of v) {
    if (d !== null && typeof d === 'object') {
      const o = d as Record<string, unknown>;
      if (typeof o['chainId'] === 'number' && typeof o['address'] === 'string') {
        out.push({ chainId: o['chainId'], address: o['address'] });
      }
    }
  }
  return out;
}
