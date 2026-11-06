import type { GitHubClient, ChangedDescriptor } from './github.js';
import type { ArkivClient } from './arkiv/client.js';
import type { Db } from './db.js';
import { descriptorHash } from './hash.js';
import { normalizeDescriptor, type EntityRecord } from './normalize/normalize.js';

/**
 * Outcome of applying a single changed descriptor file.
 * - `written`  — at least one record was normalized and upserted; hash advanced.
 * - `skipped`  — loop guard hit (content byte-identical to what we last ingested),
 *                or the descriptor emitted no records, or normalize failed.
 * - `deleted`  — the file was removed upstream; its entities were deleted.
 */
export type ApplyOutcome = 'written' | 'skipped' | 'deleted';

/**
 * Negative-cache sentinel prefix stored in the hash column for a file we fetched
 * but could not yet ingest because it uses unresolved `includes` (deferred to
 * T10). Keyed on the file's blob sha so the SAME unchanged file is not re-fetched
 * every poll. Safe to overload the hash column: a real `descriptorHash` is always
 * `0x…` hex and can never equal a `skip:includes:` string, so the two never
 * collide. A content/sha change or a future resolve overwrites it (self-heals).
 */
const INCLUDES_SKIP_PREFIX = 'skip:includes:';

function includesSkipSentinel(sha: string): string {
  return `${INCLUDES_SKIP_PREFIX}${sha}`;
}

/** Dependency bundle threaded through the sync entry points. */
export interface SyncDeps {
  github: Pick<GitHubClient, 'headSha' | 'changedDescriptors' | 'getFile'>;
  arkiv: Pick<ArkivClient, 'upsert' | 'remove' | 'queryMany'>;
  db: Pick<Db, 'getSyncCursor' | 'setSyncCursor' | 'getHash' | 'setHash'>;
  /**
   * Head ref `getFile` reads at. Normally the upstream compare head sha carried
   * by `runIngestOnce`. Defaults to `'master'` when applyChangedFile is called
   * standalone (e.g. in tests).
   */
  ref?: string;
}

/** Counts rolled up across a single ingest pass. */
export interface IngestSummary {
  written: number;
  skipped: number;
  deleted: number;
  /** eip712 (chainId,contract,selector) identity collisions observed this pass. */
  eip712Collisions: number;
  /** Total changed descriptor files examined. */
  files: number;
}

/**
 * Apply one changed descriptor file to Arkiv. See `ApplyOutcome`.
 *
 * State machine (per the T8 brief):
 *   1. removed  -> query this file's entities by `sourcePath`, delete each -> "deleted"
 *   2. loop guard: descriptorHash(content) === db.getHash(path) -> "skipped"
 *   3. normalize -> upsert each surviving record (source "github-sync") -> setHash -> "written"
 */
export async function applyChangedFile(
  file: { path: string; status: string; sha?: string },
  deps: SyncDeps,
  summary?: IngestSummary,
): Promise<ApplyOutcome> {
  const { path, status, sha } = file;
  const { github, arkiv, db } = deps;
  const ref = deps.ref ?? 'master';

  // 1. Removed upstream: delete every entity that came from this file.
  //    queryMany is scoped by sourcePath; ArkivClient pins `.createdBy(registry
  //    wallet)` INTERNALLY, so impostor entities are never in the result set.
  if (status === 'removed') {
    const rows = await arkiv.queryMany({ sourcePath: path });
    for (const row of rows) {
      const key = row.$key as `0x${string}`;
      await arkiv.remove(key);
    }
    if (summary) summary.deleted += 1;
    return 'deleted';
  }

  // 1b. Negative cache: if we already determined this exact file (by blob sha)
  //     uses unresolved includes and cannot yet be ingested, skip WITHOUT a
  //     fetch. Include-bearing files are near-universal in this registry (~475),
  //     so without this every poll would burn ~475 getFile calls re-skipping the
  //     same files against GitHub's 5000 req/hr budget. Deferred resolve: T10.
  if (sha !== undefined && db.getHash(path) === includesSkipSentinel(sha)) {
    if (summary) summary.skipped += 1;
    return 'skipped';
  }

  // 2. Fetch + loop guard. Hash the WHOLE file content object (the descriptor
  //    doc), compare to the last ingested hash for this path.
  const fetched = await github.getFile(path, ref);
  const hash = descriptorHash(fetched.content);
  if (hash === db.getHash(path)) {
    if (summary) summary.skipped += 1;
    return 'skipped';
  }

  // 2b. Unresolved includes: the sync path cannot resolve a fragment (normalize's
  //     loadFragment is sync, getFile is async — deferred to T10). Store the
  //     sha-keyed negative-cache sentinel so this file is not re-fetched next
  //     poll, then skip. (This is a SEPARATE marker from the real content hash;
  //     see INCLUDES_SKIP_PREFIX.)
  const content = fetched.content as Record<string, unknown>;
  if (typeof content['includes'] === 'string') {
    if (sha !== undefined) db.setHash(path, includesSkipSentinel(sha));
    // eslint-disable-next-line no-console
    console.warn(`[sync] skipping ${path}: uses unresolved includes (deferred to T10)`);
    if (summary) summary.skipped += 1;
    return 'skipped';
  }

  // 3. Normalize -> upsert each surviving record.
  let records: EntityRecord[];
  try {
    records = normalizeDescriptor(content, path, loadFragmentOpts(path));
  } catch (err) {
    // Normalize throws for malformed descriptors. Do not crash the whole pass:
    // skip the file (hash not advanced so a later fix re-ingests).
    // eslint-disable-next-line no-console
    console.warn(`[sync] skipping ${path}: normalize failed: ${(err as Error).message}`);
    if (summary) summary.skipped += 1;
    return 'skipped';
  }

  // Track eip712 identities we write this file so a same-file collision on
  // (chainId,contract,selector) with a DIFFERENT primaryType can be detected.
  const seenEip712 = new Map<string, string>();
  let wrote = 0;

  for (const rec of records) {
    // GUARD 2: eip712 selector identity collision. Upsert identity is only
    // (chainId,contract,selector); two distinct primaryTypes whose 4-byte
    // typeHash prefixes collide would clobber each other. Detect within this
    // file and log/count; probability ~1/2^32 per contract (see Ruling).
    if (rec.kind === 'eip712' && rec.eip712PrimaryType) {
      const idKey = `${rec.chainId}:${rec.contract}:${rec.selector}`;
      const prior = seenEip712.get(idKey);
      if (prior !== undefined && prior !== rec.eip712PrimaryType) {
        // eslint-disable-next-line no-console
        console.warn(
          `[sync] eip712 selector collision in ${path} at ${idKey}: ` +
            `"${prior}" vs "${rec.eip712PrimaryType}" — second write clobbers first`,
        );
        if (summary) summary.eip712Collisions += 1;
      } else {
        seenEip712.set(idKey, rec.eip712PrimaryType);
      }
    }

    await arkiv.upsert(rec, { source: 'github-sync', contentHash: hash });
    wrote += 1;
  }

  if (wrote === 0) {
    // The descriptor emitted no records. Do NOT advance the hash — a fixed
    // future version should re-ingest.
    if (summary) summary.skipped += 1;
    return 'skipped';
  }

  db.setHash(path, hash);
  if (summary) summary.written += 1;
  return 'written';
}

/**
 * Normalize options for the sync path. includes-bearing descriptors need a
 * synchronous fragment loader, but `getFile` is async — so the sync path passes
 * no loader and lets normalize throw (caught above). See Ruling in the report.
 */
function loadFragmentOpts(_path: string): Record<string, never> {
  return {};
}

/**
 * One ingest pass: read the stored cursor, fetch upstream head, diff, apply each
 * changed descriptor, then advance the cursor to head. Returns a count summary.
 *
 * Bootstrap: when the cursor is null (fresh DB), `since` is set to the current
 * head so the first pass diffs head..head (empty) and simply records the cursor.
 * This avoids re-ingesting the entire registry on first boot (that bulk load is
 * the separate `import` entry point). See Ruling.
 */
export async function runIngestOnce(deps: SyncDeps): Promise<IngestSummary> {
  const { github, db } = deps;
  const summary: IngestSummary = {
    written: 0,
    skipped: 0,
    deleted: 0,
    eip712Collisions: 0,
    files: 0,
  };

  const head = await github.headSha();
  const since = db.getSyncCursor() ?? head;

  const changed: ChangedDescriptor[] = await github.changedDescriptors(since);
  summary.files = changed.length;

  // Thread the compare head as the ref every getFile reads at.
  const passDeps: SyncDeps = { ...deps, ref: head };
  for (const file of changed) {
    await applyChangedFile(
      { path: file.path, status: file.status, sha: file.sha },
      passDeps,
      summary,
    );
  }

  db.setSyncCursor(head);
  return summary;
}

/**
 * Run `runIngestOnce` on a fixed interval. Returns a stop function that clears
 * the timer. The first pass is scheduled (not run inline) so the caller stays
 * non-blocking; errors in a pass are logged, never thrown out of the timer.
 */
export function startIngestLoop(deps: SyncDeps, intervalMs: number): () => void {
  const tick = (): void => {
    void runIngestOnce(deps).catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`[sync] ingest pass failed: ${(err as Error).message}`);
    });
  };
  const handle = setInterval(tick, intervalMs);
  // Do not keep the event loop alive solely for the sync timer.
  if (typeof handle.unref === 'function') handle.unref();
  return () => clearInterval(handle);
}
