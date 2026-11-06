import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { walkDescriptors } from '../src/import.js';
import {
  normalizeDescriptor,
  type EntityRecord,
} from '../src/normalize/normalize.js';
import type { LoadFragment } from '../src/normalize/includes.js';
import { toValues, type WriteMeta } from '../src/arkiv/schema.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Locate the local registry clone the importer ingests. Operators point
 * REGISTRY_ROOT at a local clone (see src/import.ts `main`); honour that first,
 * then fall back to the repo's vendored clone. We walk the `registry/` subdir —
 * the same root an operator passes and the one `toSourcePath` keys its
 * `/registry/...` sourcePath on.
 */
function registryRoot(): string {
  const fromEnv = process.env.REGISTRY_ROOT;
  if (fromEnv && fromEnv.trim() !== '') return fromEnv;
  return resolve(
    HERE,
    '../../../vendor/clear-signing-erc7730-registry/registry',
  );
}

// Identical to the loadFragment runImport uses internally (src/import.ts): the
// whole point is to walk and normalize EXACTLY what the importer ingests, so
// the emitted-record count means "what the importer would write".
const loadFragment: LoadFragment = (relPath, fromPath) =>
  JSON.parse(readFileSync(join(dirname(fromPath), relPath), 'utf8')) as Record<
    string,
    unknown
  >;

// A dummy meta — this test is PURE OFFLINE. No live Arkiv write, no Swarm
// upload. toValues only needs a well-formed contentHash + source string; it
// never contacts a chain.
const META: WriteMeta = {
  source: 'github-sync',
  contentHash: `0x${'00'.repeat(32)}`,
};

/**
 * Replica of src/import.ts' private `toSourcePath`: the importer normalizes
 * every file with the SHORT `registry/...` sourcePath (not the absolute path),
 * which is what lands in the row's indexed `sourcePath` str. Reproduce it
 * exactly so the records we feed toValues match what the importer writes —
 * otherwise an absolute path inflates sourcePath past the 128-byte str cap and
 * toValues throws on a non-existent problem.
 */
function toSourcePath(absPath: string, root: string): string {
  const norm = absPath.split('\\').join('/');
  const i = norm.lastIndexOf('/registry/');
  if (i !== -1) return norm.slice(i + 1);
  const normRoot = root.split('\\').join('/').replace(/\/+$/, '');
  return norm.startsWith(normRoot + '/') ? norm.slice(normRoot.length + 1) : norm;
}

/** What the importer emits across the whole registry, record by record. */
function emitRecords(root: string): EntityRecord[] {
  const out: EntityRecord[] = [];
  for (const absPath of walkDescriptors(root)) {
    let content: Record<string, unknown>;
    try {
      content = JSON.parse(readFileSync(absPath, 'utf8')) as Record<
        string,
        unknown
      >;
    } catch {
      // The importer skips a file whose JSON fails to parse; so do we.
      continue;
    }
    let recs: EntityRecord[];
    try {
      recs = normalizeDescriptor(content, toSourcePath(absPath, root), {
        loadFragment,
        fromPath: absPath,
      });
    } catch {
      // The importer counts a normalize failure as `failed` (not a drop of an
      // emitted record). It emits nothing for this file; mirror that.
      continue;
    }
    for (const rec of recs) out.push(rec);
  }
  return out;
}

describe('whole-registry write coverage — 0 rows dropped (was 4,523 / 16,364)', () => {
  const root = registryRoot();

  it('every emitted record is writable: toValues never throws and always emits identity + body', () => {
    expect(
      existsSync(root),
      `registry clone not found at ${root}; set REGISTRY_ROOT to a local clone's registry/ dir`,
    ).toBe(true);

    const records = emitRecords(root);
    const totalEmitted = records.length;

    let writable = 0;
    let omittedFunctionName = 0;
    let omittedEip712 = 0;

    for (let i = 0; i < records.length; i++) {
      const rec = records[i]!;
      const where = `${rec.sourcePath} [${rec.chainId}/${rec.contract}/${rec.selector}]`;

      let values: Record<string, unknown>;
      try {
        values = toValues(rec, META) as Record<string, unknown>;
      } catch (err) {
        // Fail LOUDLY naming the offending record — do not let one throw abort
        // the walk silently. No real body exceeds MAX_BODY_BYTES (120000); the
        // measured max is ~6398 bytes, so this must never fire.
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`toValues threw for record #${i} ${where}: ${msg}`);
      }

      // Identity triple + body/bodyHash are ALWAYS present, even when the
      // over-cap indexed str fields are omitted per-field.
      for (const key of ['body', 'bodyHash', 'chainId', 'contract', 'selector']) {
        expect(
          values[key],
          `record #${i} ${where} is missing required value "${key}"`,
        ).toBeDefined();
      }

      writable += 1;

      // Informational: how many rows had an over-cap field omitted per-field.
      if (values.functionName === undefined) omittedFunctionName += 1;
      if (
        rec.eip712PrimaryType !== undefined &&
        rec.eip712PrimaryType !== '' &&
        values.eip712PrimaryType === undefined
      ) {
        omittedEip712 += 1;
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      `[registry-coverage] root=${root} totalEmitted=${totalEmitted} ` +
        `writable=${writable} droppedWholeRow=${totalEmitted - writable} ` +
        `omittedFunctionName=${omittedFunctionName} omittedEip712=${omittedEip712}`,
    );

    // 0 whole-row drops: every emitted record produces a writable value row.
    expect(writable).toBe(totalEmitted);

    // Regression floor: a silent drop of rows would push this below the
    // measured full set and fail here.
    expect(writable).toBeGreaterThanOrEqual(16364);
  });
});
