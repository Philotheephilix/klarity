import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubClient, isDescriptorPath } from '../src/github.js';
import type { Config } from '../src/config.js';

// GitHubClient only consumes `config.github`; build a minimal Config and cast.
function githubConfig(): Config {
  return {
    github: {
      token: 'ghp_test',
      botLogin: 'klarity-bot',
      upstreamOwner: 'ethereum',
      upstreamRepo: 'clear-signing-erc7730-registry',
      webhookSecret: '',
    },
  } as unknown as Config;
}

// An ordered log of REST calls so tests can assert the fork-flow sequence.
type Call = { name: string; args: any };

function fakeOctokit(overrides: Record<string, any> = {}) {
  const calls: Call[] = [];
  const rec =
    (name: string, impl: (args: any) => any) =>
    (args: any) => {
      calls.push({ name, args });
      return Promise.resolve(impl(args));
    };

  const octokit = {
    calls,
    repos: {
      getBranch: rec('repos.getBranch', () => ({
        data: { commit: { sha: 'UPSTREAM_HEAD_SHA' } },
      })),
      compareCommitsWithBasehead: rec(
        'repos.compareCommitsWithBasehead',
        () => ({ data: { files: [] } })
      ),
      getContent: rec('repos.getContent', () => ({
        data: {
          content: Buffer.from(JSON.stringify({ hello: 'world' })).toString(
            'base64'
          ),
          encoding: 'base64',
          sha: 'BLOB_SHA',
        },
      })),
      createFork: rec('repos.createFork', () => ({ data: {} })),
      createOrUpdateFileContents: rec(
        'repos.createOrUpdateFileContents',
        () => ({ data: { commit: { sha: 'NEW_COMMIT' } } })
      ),
      deleteFile: rec('repos.deleteFile', () => ({
        data: { commit: { sha: 'DEL_COMMIT' } },
      })),
    },
    git: {
      createRef: rec('git.createRef', () => ({ data: {} })),
    },
    pulls: {
      create: rec('pulls.create', () => ({
        data: { html_url: 'https://github.com/ethereum/clear-signing-erc7730-registry/pull/42' },
      })),
    },
  };

  // Shallow-merge per-test overrides, wrapping each so the call is still logged
  // (so order/arg assertions see overridden methods too).
  for (const [ns, methods] of Object.entries(overrides)) {
    for (const [method, impl] of Object.entries(methods as Record<string, any>)) {
      (octokit as any)[ns][method] = rec(`${ns}.${method}`, (args: any) => {
        const out = (impl as (a: any) => any)(args);
        // Unwrap a returned Promise so `rec` resolves the real value.
        return out;
      });
    }
  }
  return octokit;
}

describe('isDescriptorPath', () => {
  it('keeps registry/**/*.json and drops tests/testsv2/sigs/common-*', () => {
    expect(isDescriptorPath('registry/aave/calldata-Pool.json')).toBe(true);
    expect(isDescriptorPath('registry/aave/tests/foo.json')).toBe(false);
    expect(isDescriptorPath('registry/aave/testsv2/foo.json')).toBe(false);
    expect(isDescriptorPath('registry/aave/sigs/foo.json')).toBe(false);
    expect(isDescriptorPath('registry/aave/common-abi.json')).toBe(false);
    expect(isDescriptorPath('registry/aave/calldata-Pool.yaml')).toBe(false);
    expect(isDescriptorPath('docs/registry/x.json')).toBe(false);
  });
});

describe('GitHubClient.changedDescriptors', () => {
  it('returns ONLY registry descriptor json, dropping sigs/testsv2/common-*', async () => {
    const octokit = fakeOctokit({
      repos: {
        compareCommitsWithBasehead: (args: any) => {
          return Promise.resolve({
            data: {
              files: [
                { filename: 'registry/aave/calldata-Pool.json', status: 'modified', sha: 'sha-pool' },
                { filename: 'registry/uniswap/eip712-Permit.json', status: 'added', sha: 'sha-permit' },
                { filename: 'registry/aave/sigs/calldata-Pool.json', status: 'added', sha: 'sha-sig' },
                { filename: 'registry/aave/testsv2/case1.json', status: 'added', sha: 'sha-test' },
                { filename: 'registry/aave/common-abi.json', status: 'modified', sha: 'sha-common' },
                { filename: 'README.md', status: 'modified', sha: 'sha-readme' },
              ],
            },
          });
        },
      },
    });
    const client = new GitHubClient(githubConfig(), octokit);
    const result = await client.changedDescriptors('OLD_SHA');

    // Exact kept set — path, status, sha preserved; everything else dropped.
    expect(result).toEqual([
      { path: 'registry/aave/calldata-Pool.json', status: 'modified', sha: 'sha-pool' },
      { path: 'registry/uniswap/eip712-Permit.json', status: 'added', sha: 'sha-permit' },
    ]);

    // Basehead uses `${sinceSha}...master`.
    const cmp = octokit.calls.find(
      (c) => c.name === 'repos.compareCommitsWithBasehead'
    )!;
    expect(cmp.args.basehead).toBe('OLD_SHA...master');
    expect(cmp.args.owner).toBe('ethereum');
    expect(cmp.args.repo).toBe('clear-signing-erc7730-registry');
  });
});

describe('GitHubClient.headSha', () => {
  it('returns the upstream master HEAD commit sha', async () => {
    const octokit = fakeOctokit();
    const client = new GitHubClient(githubConfig(), octokit);
    expect(await client.headSha()).toBe('UPSTREAM_HEAD_SHA');
    const call = octokit.calls.find((c) => c.name === 'repos.getBranch')!;
    expect(call.args.branch).toBe('master');
  });
});

describe('GitHubClient.getFile', () => {
  it('base64-decodes and JSON-parses the content', async () => {
    const payload = { intent: 'Supply', chainId: 1 };
    const octokit = fakeOctokit({
      repos: {
        getContent: (args: any) =>
          Promise.resolve({
            data: {
              content: Buffer.from(JSON.stringify(payload)).toString('base64'),
              encoding: 'base64',
              sha: 'CONTENT_BLOB',
            },
          }),
      },
    });
    const client = new GitHubClient(githubConfig(), octokit);
    const res = await client.getFile('registry/aave/calldata-Pool.json', 'master');
    expect(res.content).toEqual(payload);
    expect(res.sha).toBe('CONTENT_BLOB');
  });
});

describe('GitHubClient.openDescriptorPR (create)', () => {
  it('runs fork -> createRef -> createOrUpdateFileContents -> pulls.create in order and returns the PR url', async () => {
    const octokit = fakeOctokit();
    const client = new GitHubClient(githubConfig(), octokit);
    const url = await client.openDescriptorPR({
      path: 'registry/aave/calldata-Pool.json',
      descriptor: { intent: 'Supply', fields: [] },
      entityKey: '0xENTITYKEY',
      wallet: '0xWALLET',
      action: 'create',
    });

    expect(url).toBe(
      'https://github.com/ethereum/clear-signing-erc7730-registry/pull/42'
    );

    // Assert the exact ordered sequence of mutating REST calls.
    const seq = octokit.calls
      .map((c) => c.name)
      .filter((n) =>
        [
          'repos.createFork',
          'git.createRef',
          'repos.createOrUpdateFileContents',
          'pulls.create',
        ].includes(n)
      );
    expect(seq).toEqual([
      'repos.createFork',
      'git.createRef',
      'repos.createOrUpdateFileContents',
      'pulls.create',
    ]);

    // createRef targets the FORK, off the UPSTREAM HEAD sha.
    const ref = octokit.calls.find((c) => c.name === 'git.createRef')!;
    expect(ref.args.owner).toBe('klarity-bot');
    expect(ref.args.repo).toBe('clear-signing-erc7730-registry');
    expect(ref.args.sha).toBe('UPSTREAM_HEAD_SHA');
    expect(ref.args.ref).toMatch(/^refs\/heads\/klarity\//);

    // contents write targets the fork and base64-encodes the descriptor.
    const put = octokit.calls.find(
      (c) => c.name === 'repos.createOrUpdateFileContents'
    )!;
    expect(put.args.owner).toBe('klarity-bot');
    const decoded = Buffer.from(put.args.content, 'base64').toString('utf8');
    expect(JSON.parse(decoded)).toEqual({ intent: 'Supply', fields: [] });
    // create omits the blob sha.
    expect(put.args.sha).toBeUndefined();

    // Cross-repo PR: head "<bot>:<branch>" against upstream master.
    const pr = octokit.calls.find((c) => c.name === 'pulls.create')!;
    expect(pr.args.owner).toBe('ethereum');
    expect(pr.args.repo).toBe('clear-signing-erc7730-registry');
    expect(pr.args.base).toBe('master');
    expect(pr.args.head).toMatch(/^klarity-bot:klarity\//);
  });

  it('commit message carries both Arkiv-Origin and Arkiv-Entity markers', async () => {
    const octokit = fakeOctokit();
    const client = new GitHubClient(githubConfig(), octokit);
    await client.openDescriptorPR({
      path: 'registry/aave/calldata-Pool.json',
      descriptor: { intent: 'Supply' },
      entityKey: '0xDEADBEEF',
      wallet: '0xWALLET',
      action: 'create',
    });
    const put = octokit.calls.find(
      (c) => c.name === 'repos.createOrUpdateFileContents'
    )!;
    expect(put.args.message).toContain('Arkiv-Origin: true');
    expect(put.args.message).toContain('Arkiv-Entity: 0xDEADBEEF');
  });

  it('proceeds when createFork rejects with an already-exists signal (fork already present)', async () => {
    const octokit = fakeOctokit({
      repos: {
        createFork: () =>
          Promise.reject(
            Object.assign(new Error('Repository already exists on this account'), {
              status: 422,
            })
          ),
      },
    });
    const client = new GitHubClient(githubConfig(), octokit);
    const url = await client.openDescriptorPR({
      path: 'registry/aave/calldata-Pool.json',
      descriptor: { intent: 'Supply' },
      entityKey: '0xKEY',
      wallet: '0xWALLET',
      action: 'create',
    });
    // fork-exists did not abort: downstream calls all still happened.
    expect(octokit.calls.some((c) => c.name === 'git.createRef')).toBe(true);
    expect(
      octokit.calls.some((c) => c.name === 'repos.createOrUpdateFileContents')
    ).toBe(true);
    expect(octokit.calls.some((c) => c.name === 'pulls.create')).toBe(true);
    expect(url).toBe(
      'https://github.com/ethereum/clear-signing-erc7730-registry/pull/42'
    );
  });
});

describe('GitHubClient.openDescriptorPR (update)', () => {
  it('includes the existing blob sha when updating', async () => {
    const octokit = fakeOctokit();
    const client = new GitHubClient(githubConfig(), octokit);
    await client.openDescriptorPR({
      path: 'registry/aave/calldata-Pool.json',
      descriptor: { intent: 'Supply v2' },
      entityKey: '0xKEY',
      wallet: '0xWALLET',
      action: 'update',
    });
    const put = octokit.calls.find(
      (c) => c.name === 'repos.createOrUpdateFileContents'
    )!;
    // getContent on the branch supplies BLOB_SHA from the default fake.
    expect(put.args.sha).toBe('BLOB_SHA');
  });
});

describe('GitHubClient.openDescriptorPR (delete)', () => {
  it('routes to deleteFile (not createOrUpdateFileContents) with the blob sha', async () => {
    const octokit = fakeOctokit();
    const client = new GitHubClient(githubConfig(), octokit);
    await client.openDescriptorPR({
      path: 'registry/aave/calldata-Pool.json',
      descriptor: {},
      entityKey: '0xKEY',
      wallet: '0xWALLET',
      action: 'delete',
    });
    const del = octokit.calls.find((c) => c.name === 'repos.deleteFile');
    const put = octokit.calls.find(
      (c) => c.name === 'repos.createOrUpdateFileContents'
    );
    expect(del).toBeDefined();
    expect(put).toBeUndefined();
    expect(del!.args.sha).toBe('BLOB_SHA');
    expect(del!.args.message).toContain('Arkiv-Origin: true');
    expect(del!.args.message).toContain('Arkiv-Entity: 0xKEY');
    // delete still opens the cross-repo PR.
    const pr = octokit.calls.find((c) => c.name === 'pulls.create')!;
    expect(pr.args.base).toBe('master');
  });
});
