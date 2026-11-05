import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { GitHubClient } from './github.js';
import type { ArkivClient } from './arkiv/client.js';
import type { Db } from './db.js';
import { descriptorHash } from './hash.js';
import {
  normalizeDescriptor,
  type EntityRecord,
} from './normalize/normalize.js';
import type { LoadFragment } from './normalize/includes.js';
import { recordExceedsStringCap, MAX_STRING_BYTES } from './sync.js';

/**
 * Dependency bundle for the backfill importer. A strict subset of what the
 * sync loop needs — the one-shot import never diffs or deletes, it only walks,
 * normalizes, upserts, and advances the hash + cursor. `github` is optional in
 * `{root}` mode: it is only used to resolve the head sha the cursor is parked
 * at so the incremental loop resumes from the imported head. In the pure-local
 * test path it is omitted and the cursor is left untouched (see Ruling).
 */
export interface ImportDeps {
  arkiv: Pick<ArkivClient, 'upsert'>;
  db: Pick<Db, 'getHash' | 'setHash' | 'setSyncCursor'>;
  github?: Pick<GitHubClient, 'headSha'>;
}

/** Local-filesystem backfill source: walk this registry root. */
export interface RootSource {
  root: string;
}

/** GitHub backfill source: walk the upstream tree at head. */
export interface GitHubSource {
  fromGitHub: true;
}

export type ImportSource = RootSource | GitHubSource;

/** Rolled-up counts across one backfill run. Mirrors the sync summary vocabulary. */
export interface ImportSummary {
  /** Source descriptor files whose records were (re)written this run. */
  upserted: number;
  /** Files skipped by the loop guard (byte-identical hash) or empty after guards. */
  skipped: number;
  /** Files that failed to parse / normalize and were not written. */
  failed: number;
  /** Total emit-source descriptor files walked. */
  files: number;
  /** Individual EntityRecords upserted (sum across all written files). */
  records: number;
  /** Records dropped for exceeding the 128-byte str cap. */
  oversizedRecords: number;
  /** eip712 (chainId,contract,selector) identity collisions observed. */
  eip712Collisions: number;
}

/**
 * Ruling: concurrency = 8. The real registry is ~740 emit files / ~16.4k
 * records; a hand-rolled pool of 8 keeps Arkiv write pressure bounded without a
 * new dependency. Cost if wrong: too high throttles Rabdi (retries absorb it);
 * too low just makes the one-shot slower. Tunable here, not a correctness lever.
 */
const DEFAULT_CONCURRENCY = 8;

/**
 * Run the one-shot backfill. Walks every emit-source descriptor, normalizes it
 * (RESOLVING includes — this is the whole reason T10 exists; the incremental
 * sync loop defers include-bearing files), upserts each record with
 * `source:"github-sync"`, records the per-file content hash, and finally parks
 * the sync cursor at the imported head so the incremental loop resumes cleanly.
 *
 * Idempotent: a second run over unchanged files is entirely `skipped` (the
 * descriptorHash loop guard matches the stored hash), and `arkiv.upsert` is not
 * called again.
 */
export async function runImport(
  source: ImportSource,
  deps: ImportDeps,
  opts: { concurrency?: number } = {},
): Promise<ImportSummary> {
  if ('fromGitHub' in source) {
    return runImportFromGitHub(deps, opts);
  }
  return runImportFromRoot(source.root, deps, opts);
}

async function runImportFromRoot(
  root: string,
  deps: ImportDeps,
  opts: { concurrency?: number },
): Promise<ImportSummary> {
  const summary = emptySummary();
  const files = walkDescriptors(root);
  summary.files = files.length;

  // Local-fs fragment loader: resolve `relPath` against the DIRECTORY of the
  // including file (POSIX join), read + parse. Mirrors the normalizer's own
  // resolveRelative (strip last segment, append relPath). Passed on EVERY
  // normalize call — harmless for files that declare no includes.
  const loadFragment: LoadFragment = (relPath, fromPath) =>
    JSON.parse(readFileSync(join(dirname(fromPath), relPath), 'utf8')) as Record<
      string,
      unknown
    >;

  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  await runPool(files, concurrency, async (absPath) => {
    const sourcePath = toSourcePath(absPath, root);
    let content: Record<string, unknown>;
    try {
      content = JSON.parse(readFileSync(absPath, 'utf8')) as Record<
        string,
        unknown
      >;
    } catch (err) {
      logWarn(`[import] skipping ${sourcePath}: parse failed: ${msg(err)}`);
      summary.failed += 1;
      return;
    }
    await applyDescriptorFile(
      { content, sourcePath, fromPath: absPath, loadFragment },
      deps,
      summary,
    );
  });

  // Park the cursor at the upstream head (if a github dep was supplied) so the
  // incremental loop diffs head..head on first poll instead of re-importing the
  // whole registry. Pure-local test mode (no github dep) leaves the cursor
  // untouched — see Ruling.
  if (deps.github) {
    const head = await deps.github.headSha();
    deps.db.setSyncCursor(head);
  }

  return summary;
}

/**
 * Ruling: `{fromGitHub}` is out of robust scope for T10 and is intentionally a
 * documented, loud stub. GitHubClient exposes no full-tree listing (only a
 * `since..head` diff via `changedDescriptors` and per-file `getFile`), so a
 * correct whole-registry GitHub walk would need a new tree-listing method + a
 * getFile-backed async fragment loader — out of scope and untestable without
 * live GitHub. The tested, include-resolving path is `{root}`; operators run
 * the backfill against a local clone of the registry and let the incremental
 * loop (T8) take over from the parked cursor. Cost if wrong: an operator who
 * wanted a GitHub-sourced backfill gets a clear error pointing at `{root}`,
 * not silent partial data.
 */
function runImportFromGitHub(
  _deps: ImportDeps,
  _opts: { concurrency?: number },
): Promise<ImportSummary> {
  throw new Error(
    'runImport({fromGitHub}) is not implemented in T10: GitHubClient has no ' +
      'whole-tree listing. Clone the registry and run runImport({root}) against ' +
      'it (includes are resolved from the local filesystem).',
  );
}

/**
 * Apply one descriptor file to Arkiv. Hash loop-guard, normalize (includes +
 * $refs resolved), then upsert each surviving record behind the SAME two guards
 * the sync writer uses (128-byte str cap + in-file eip712 selector-identity
 * collision detection). Advances the stored hash only when at least one record
 * is written, so a file whose records were all dropped re-ingests on a fix.
 */
async function applyDescriptorFile(
  input: {
    content: Record<string, unknown>;
    sourcePath: string;
    fromPath: string;
    loadFragment: LoadFragment;
  },
  deps: ImportDeps,
  summary: ImportSummary,
): Promise<void> {
  const { content, sourcePath, fromPath, loadFragment } = input;
  const hash = descriptorHash(content);

  // Loop guard: byte-identical content already ingested -> skip (no upsert).
  if (hash === deps.db.getHash(sourcePath)) {
    summary.skipped += 1;
    return;
  }

  let records: EntityRecord[];
  try {
    records = normalizeDescriptor(content, sourcePath, { loadFragment, fromPath });
  } catch (err) {
    // Always passes a loader, so a throw here is a genuinely malformed
    // descriptor (not a missing fragment). Skip it; hash is NOT advanced.
    logWarn(`[import] skipping ${sourcePath}: normalize failed: ${msg(err)}`);
    summary.failed += 1;
    return;
  }

  const seenEip712 = new Map<string, string>();
  let wrote = 0;
  for (const rec of records) {
    // GUARD 1: drop oversized-field records (would make Arkiv throw at write).
    if (recordExceedsStringCap(rec)) {
      logWarn(
        `[import] skipping record ${rec.chainId}/${rec.contract}/${rec.selector} ` +
          `in ${sourcePath}: string field exceeds ${MAX_STRING_BYTES} bytes`,
      );
      summary.oversizedRecords += 1;
      continue;
    }
    // GUARD 2: detect in-file eip712 (chainId,contract,selector) collisions.
    if (rec.kind === 'eip712' && rec.eip712PrimaryType) {
      const idKey = `${rec.chainId}:${rec.contract}:${rec.selector}`;
      const prior = seenEip712.get(idKey);
      if (prior !== undefined && prior !== rec.eip712PrimaryType) {
        logWarn(
          `[import] eip712 selector collision in ${sourcePath} at ${idKey}: ` +
            `"${prior}" vs "${rec.eip712PrimaryType}" — second write clobbers first`,
        );
        summary.eip712Collisions += 1;
      } else {
        seenEip712.set(idKey, rec.eip712PrimaryType);
      }
    }

    await deps.arkiv.upsert(rec, { source: 'github-sync', contentHash: hash });
    wrote += 1;
  }

  if (wrote === 0) {
    // All records dropped by guards (or none emitted). Do not advance the hash.
    summary.skipped += 1;
    return;
  }

  deps.db.setHash(sourcePath, hash);
  summary.records += wrote;
  summary.upserted += 1;
}

/**
 * Walk a local registry root and return absolute paths of every emit-source
 * descriptor. Ported from scripts/analyze.mjs (the validated walk):
 *   - recurse, SKIP dirs named `tests`, `testsv2`, `sigs`
 *   - take `*.json`, EXCLUDE `*.tests.json` / `*.test.json`
 *   - EXCLUDE `common-*.json` (include fragment targets, not emit descriptors)
 *
 * Ruling: ported locally rather than extracted from sync.ts. sync.ts has NO
 * filesystem walk — its `isDescriptorPath` operates on repo-relative GitHub
 * path STRINGS and hard-requires a `registry/` prefix, which a local fixtures
 * root does not have. Extracting it would mean rewriting T8's reviewed string
 * logic into an fs recursion; porting the analyze.mjs rules here is cleaner and
 * leaves T8 untouched. Cost if wrong: the two exclusion lists could drift — but
 * both derive from the same analyze.mjs source and are covered by tests.
 */
export function walkDescriptors(root: string): string[] {
  const out: string[] = [];
  const recurse = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      const s = statSync(p);
      if (s.isDirectory()) {
        if (entry === 'tests' || entry === 'testsv2' || entry === 'sigs') continue;
        recurse(p);
      } else if (entry.endsWith('.json')) {
        if (/\.tests?\.json$/.test(entry)) continue;
        if (/^common-[^/]+\.json$/.test(entry)) continue;
        out.push(p);
      }
    }
  };
  recurse(root);
  out.sort();
  return out;
}

/**
 * Derive the descriptor `sourcePath` the normalizer and Arkiv store. We key on
 * a `registry/...` suffix when the path contains a `registry` segment (matching
 * the GitHub-sourced sourcePath), else fall back to the path relative to the
 * walked root. Keeps entityName derivation (which looks for `registry`) working.
 */
function toSourcePath(absPath: string, root: string): string {
  const norm = absPath.split('\\').join('/');
  const i = norm.lastIndexOf('/registry/');
  if (i !== -1) return norm.slice(i + 1);
  const normRoot = root.split('\\').join('/').replace(/\/+$/, '');
  return norm.startsWith(normRoot + '/') ? norm.slice(normRoot.length + 1) : norm;
}

/**
 * Run `worker` over `items` with at most `limit` in flight. A tiny hand-rolled
 * pool (no dependency). Rejections propagate — a backfill should fail loud if
 * the Arkiv writer itself (not a single bad descriptor, which we swallow) dies.
 */
async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const size = Math.max(1, Math.min(limit, items.length || 1));
  const runners: Promise<void>[] = [];
  for (let i = 0; i < size; i++) {
    runners.push(
      (async () => {
        while (next < items.length) {
          const idx = next++;
          await worker(items[idx]!);
        }
      })(),
    );
  }
  await Promise.all(runners);
}

function emptySummary(): ImportSummary {
  return {
    upserted: 0,
    skipped: 0,
    failed: 0,
    files: 0,
    records: 0,
    oversizedRecords: 0,
    eip712Collisions: 0,
  };
}

function logWarn(line: string): void {
  // eslint-disable-next-line no-console
  console.warn(line);
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// --- CLI entry ---------------------------------------------------------------

/**
 * CLI main. Reads config from the environment, builds the real deps, and runs
 * the backfill against REGISTRY_ROOT (local clone). Guarded behind an
 * import.meta.url main-check so importing this module (dist-load smoke test,
 * unit tests) never triggers the walk.
 */
async function main(): Promise<void> {
  const { loadConfig } = await import('./config.js');
  const { openDb } = await import('./db.js');
  const { ArkivClient } = await import('./arkiv/client.js');
  const { GitHubClient } = await import('./github.js');

  const config = loadConfig();
  const root = process.env.REGISTRY_ROOT;
  if (!root || root.trim() === '') {
    throw new Error('REGISTRY_ROOT must point at a local clone of the registry');
  }
  const db = openDb(config.dbPath);
  const arkiv = new ArkivClient(config);
  const github = new GitHubClient(config);

  logWarn(`[import] backfilling from ${root} ...`);
  const summary = await runImport({ root }, { arkiv, db, github });
  // eslint-disable-next-line no-console
  console.log('[import] done:', JSON.stringify(summary));
}

// Only run when executed directly (node dist/import.js), never on import.
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[import] failed:', msg(err));
    process.exit(1);
  });
}

// Re-exported for callers that want the T8-shared guards.
export { recordExceedsStringCap, MAX_STRING_BYTES };
