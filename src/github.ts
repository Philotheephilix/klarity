import { Octokit } from '@octokit/rest';
import { throttling } from '@octokit/plugin-throttling';
import { retry } from '@octokit/plugin-retry';
import type { Config } from './config.js';
import type { WriteAction } from './auth.js';

/** A descriptor file that changed upstream between `sinceSha` and `master`. */
export interface ChangedDescriptor {
  path: string;
  /** GitHub compare file status: added | modified | removed | renamed | copied | changed | unchanged. */
  status: string;
  /** Blob sha of the file at the head of the compare range. */
  sha: string;
}

/** Decoded descriptor content plus its blob sha (for update-with-sha writes). */
export interface FileContent {
  content: object;
  sha: string;
}

/** Arguments for opening a fork-flow PR back to the upstream registry. */
export interface OpenDescriptorPROptions {
  /** Repo-relative path, e.g. `registry/aave/calldata-Pool.json`. */
  path: string;
  /** The descriptor object to write (serialized to pretty JSON). */
  descriptor: object;
  /** Arkiv entity key — carried in the commit as the loop-guard marker. */
  entityKey: string;
  /** Authorizing EF wallet address — recorded in the commit/PR context. */
  wallet: string;
  /** Mutation intent. */
  action: WriteAction;
}

/** Loop-guard markers T8 reads to avoid re-ingesting our own PRs. */
const ORIGIN_MARKER = 'Arkiv-Origin: true';
const ENTITY_MARKER_PREFIX = 'Arkiv-Entity: ';

// A loosely-typed Octokit — the plugged instance's deep generics would leak
// across the module boundary and make test injection awkward, so we pin the
// surface we use to `any` at the seam.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OctokitLike = any;

/**
 * Builds the production Octokit: real REST client plugged with throttling and
 * retry. Throttle handlers tell Octokit to retry primary rate limits a couple
 * of times and to back off on secondary limits — never throw synchronously.
 */
function buildOctokit(token: string): OctokitLike {
  const Plugged = Octokit.plugin(throttling, retry);
  return new Plugged({
    auth: token,
    throttle: {
      onRateLimit: (
        retryAfter: number,
        options: { method: string; url: string },
        _octokit: unknown,
        retryCount: number
      ): boolean => {
        // Retry the first two primary rate-limit hits.
        return retryCount < 2;
      },
      onSecondaryRateLimit: (
        retryAfter: number,
        options: { method: string; url: string }
      ): boolean => {
        // Retry once on secondary (abuse) rate limits.
        return true;
      },
    },
  });
}

/**
 * Determines whether a changed upstream path is a descriptor file Klarity
 * ingests. Mirrors the T4 ledger normalizer's exclusion rules:
 *   - must be under `registry/` and end in `.json`
 *   - never under a `tests` / `testsv2` / `sigs` path segment
 *   - filename must NOT start with `common-` (shared fragments, not descriptors)
 */
export function isDescriptorPath(path: string): boolean {
  if (!path.startsWith('registry/')) return false;
  if (!path.endsWith('.json')) return false;
  const segments = path.split('/');
  if (segments.some((s) => s === 'tests' || s === 'testsv2' || s === 'sigs')) {
    return false;
  }
  const filename = segments[segments.length - 1];
  if (filename.startsWith('common-')) return false;
  return true;
}

/**
 * GitHub client for the two halves of the sync:
 *   - INGEST: `changedDescriptors` reads which descriptor files changed upstream
 *     since a known sha (consumed by the T8 sync loop).
 *   - EGRESS: `openDescriptorPR` opens a fork-flow PR back to upstream with the
 *     authoritative write (consumed by the T9 signed-write path).
 *
 * The commit messages carry `Arkiv-Origin` + `Arkiv-Entity` markers so T8 can
 * skip re-ingesting PRs this service itself opened.
 */
export class GitHubClient {
  private readonly octokit: OctokitLike;
  private readonly upstreamOwner: string;
  private readonly upstreamRepo: string;
  private readonly botLogin: string;

  /**
   * @param config full service config (reads `config.github`)
   * @param octokit optional pre-built Octokit for test injection; production
   *   callers omit it and get the real throttled/retrying client.
   */
  constructor(config: Config, octokit?: OctokitLike) {
    this.upstreamOwner = config.github.upstreamOwner;
    this.upstreamRepo = config.github.upstreamRepo;
    this.botLogin = config.github.botLogin;
    this.octokit = octokit ?? buildOctokit(config.github.token);
  }

  /** HEAD commit sha of the upstream default branch (`master`). */
  async headSha(): Promise<string> {
    const res = await this.octokit.repos.getBranch({
      owner: this.upstreamOwner,
      repo: this.upstreamRepo,
      branch: 'master',
    });
    return res.data.commit.sha as string;
  }

  /**
   * Descriptor files that changed upstream between `sinceSha` and `master`,
   * filtered to real registry descriptors (see `isDescriptorPath`).
   */
  async changedDescriptors(sinceSha: string): Promise<ChangedDescriptor[]> {
    const res = await this.octokit.repos.compareCommitsWithBasehead({
      owner: this.upstreamOwner,
      repo: this.upstreamRepo,
      basehead: `${sinceSha}...master`,
    });
    const files: Array<{ filename: string; status: string; sha: string }> =
      res.data.files ?? [];
    return files
      .filter((f) => isDescriptorPath(f.filename))
      .map((f) => ({ path: f.filename, status: f.status, sha: f.sha }));
  }

  /**
   * Reads a file at `ref`, base64-decoding and JSON-parsing its content.
   * Returns the parsed object plus the blob sha (needed to update it later).
   */
  async getFile(path: string, ref: string): Promise<FileContent> {
    const res = await this.octokit.repos.getContent({
      owner: this.upstreamOwner,
      repo: this.upstreamRepo,
      path,
      ref,
    });
    const data = res.data as { content: string; encoding: string; sha: string };
    const decoded = Buffer.from(data.content, 'base64').toString('utf8');
    return { content: JSON.parse(decoded), sha: data.sha };
  }

  /**
   * Fork-flow egress: open a cross-repo PR against the upstream registry.
   *
   * 1. Ensure the bot's fork exists (createFork is idempotent).
   * 2. Branch the fork off the current upstream HEAD sha.
   * 3. Write the descriptor on that branch (createOrUpdateFileContents, or
   *    deleteFile for a delete). The commit carries the loop-guard markers.
   * 4. Open a cross-repo PR `head: "<botLogin>:<branch>"` -> upstream `master`.
   *
   * @returns the created PR's `html_url`.
   */
  async openDescriptorPR(opts: OpenDescriptorPROptions): Promise<string> {
    const { path, descriptor, entityKey, wallet, action } = opts;

    // 1. Ensure the fork exists. createFork is idempotent: a 2xx on an existing
    //    fork is fine; we treat any already-exists signal as success.
    await this.octokit.repos.createFork({
      owner: this.upstreamOwner,
      repo: this.upstreamRepo,
    });

    // 2. Branch off upstream HEAD, on the fork.
    const baseSha = await this.headSha();
    const branch = `klarity/${entityKey}-${Date.now()}`;
    await this.octokit.git.createRef({
      owner: this.botLogin,
      repo: this.upstreamRepo,
      ref: `refs/heads/${branch}`,
      sha: baseSha,
    });

    // Commit body with the loop-guard markers T8 reads, plus the authorizing
    // wallet for provenance.
    const commitMessage = [
      `${action} descriptor ${path}`,
      '',
      ORIGIN_MARKER,
      `${ENTITY_MARKER_PREFIX}${entityKey}`,
      `Arkiv-Wallet: ${wallet}`,
    ].join('\n');

    // 3. Write the descriptor on the fork branch.
    if (action === 'delete') {
      // Delete needs the existing blob sha at this ref.
      const existing = await this.getFile(path, branch);
      await this.octokit.repos.deleteFile({
        owner: this.botLogin,
        repo: this.upstreamRepo,
        path,
        message: commitMessage,
        sha: existing.sha,
        branch,
      });
    } else {
      const encoded = Buffer.from(
        JSON.stringify(descriptor, null, 2),
        'utf8'
      ).toString('base64');
      // For an update, include the existing blob sha so GitHub overwrites rather
      // than rejecting with a 422. A missing file (create) just omits sha.
      let existingSha: string | undefined;
      if (action === 'update') {
        try {
          const existing = await this.getFile(path, branch);
          existingSha = existing.sha;
        } catch {
          // File not present on the branch — treat as a create.
          existingSha = undefined;
        }
      }
      await this.octokit.repos.createOrUpdateFileContents({
        owner: this.botLogin,
        repo: this.upstreamRepo,
        path,
        message: commitMessage,
        content: encoded,
        branch,
        ...(existingSha ? { sha: existingSha } : {}),
      });
    }

    // 4. Cross-repo PR: fork branch -> upstream master.
    const prBody = [
      `Automated clear-signing descriptor ${action} from Klarity.`,
      '',
      ORIGIN_MARKER,
      `${ENTITY_MARKER_PREFIX}${entityKey}`,
      `Authorized by wallet: ${wallet}`,
    ].join('\n');
    const pr = await this.octokit.pulls.create({
      owner: this.upstreamOwner,
      repo: this.upstreamRepo,
      title: `${action}: ${path}`,
      head: `${this.botLogin}:${branch}`,
      base: 'master',
      body: prBody,
    });
    return pr.data.html_url as string;
  }
}
