# GitHub Two-Way Sync — Research

Service mirrors files from `ethereum/clear-signing-erc7730-registry` into Arkiv and syncs both directions. Target repo layout: ERC-7730 descriptor JSON files live under `registry/<project>/*.json`.

---

## 1. GitHub → DB (ingest merges)

### Option A — Webhooks (recommended for prod, best signal)

Configure a webhook on the upstream repo (or your fork) for the `pull_request` and `push` events.

**`pull_request` closed/merged payload — key fields:**
```jsonc
{
  "action": "closed",
  "pull_request": {
    "merged": true,                 // <- TRUE only on a real merge, false on plain close
    "merge_commit_sha": "abc123…",
    "base": { "ref": "master", "repo": { "full_name": "ethereum/clear-signing-erc7730-registry" } },
    "number": 412
  }
}
```
Act only when `action === "closed" && pull_request.merged === true` and `base.ref` is the default branch.

**`push` payload — key fields** (fires on direct pushes/merges to a branch):
```jsonc
{
  "ref": "refs/heads/master",
  "head_commit": { "id": "…", "added": ["registry/foo/eip712.json"], "modified": [...], "removed": [...] },
  "commits": [ { "added": [...], "modified": [...], "removed": [...] } ]
}
```
`push` gives you changed-file lists directly in `commits[].{added,modified,removed}` and `head_commit`. **This is the simplest way to know which descriptor files changed** — union the added/modified/removed arrays across commits, filter to `registry/**/*.json`.

**Signature verification (`X-Hub-Signature-256`):** HMAC-SHA256 hex digest of the **raw** request body, keyed by the webhook secret, prefixed `sha256=`. Verify with a constant-time compare on the *raw* bytes (parse JSON only after verifying):
```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(raw: Buffer, header: string, secret: string): boolean {
  const expected = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(header ?? "");
  return a.length === b.length && timingSafeEqual(a, b);
}
```
Headers to read: `X-GitHub-Event` (event name), `X-GitHub-Delivery` (GUID — good idempotency key), `X-Hub-Signature-256`.

Caveat: `push` payloads cap at 25 MB; giant merges may not be delivered — treat polling as a fallback reconciler.

### Option B — Polling (recommended as the hackathon default + prod reconciler)

No public URL needed (works on localhost), dead simple, good enough at hackathon scale.
```ts
// since last sync: list commits on default branch, diff each (or use compare endpoint)
const { data } = await octokit.repos.compareCommitsWithBasehead({
  owner: "ethereum", repo: "clear-signing-erc7730-registry",
  basehead: `${lastSyncedSha}...master`,
});
const changed = data.files?.filter(f => f.filename.match(/^registry\/.*\.json$/)) ?? [];
// each file: f.status ("added"|"modified"|"removed"), f.filename, f.sha (blob sha)
// fetch content:
const blob = await octokit.repos.getContent({ owner, repo, path: f.filename, ref: "master" });
```
`compareCommitsWithBasehead` returns `files[]` with `status` + `filename` — exactly the changed-descriptor list. Persist `lastSyncedSha` (the current `master` HEAD) after each run. Poll on a timer (e.g. every 60–120 s).

**Recommendation:** ship **polling first** (zero infra, works behind any firewall), add the webhook endpoint as an optional fast-path. They share the same "apply changed files to DB" code path.

---

## 2. DB → GitHub (fork-flow PR with Octokit)

`@octokit/rest`. Flow: ensure fork → get base ref → branch on fork → commit file on fork → open cross-repo PR to upstream.

```ts
import { Octokit } from "@octokit/rest";
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const UP = { owner: "ethereum", repo: "clear-signing-erc7730-registry" };
const BOT = (await octokit.users.getAuthenticated()).data.login; // your bot identity
const FORK = { owner: BOT, repo: UP.repo };

// (a) ensure fork exists (idempotent — returns existing fork if already forked)
await octokit.repos.createFork({ ...UP });            // async on GitHub's side; poll until ready
// optionally wait: repos.get({...FORK}) until 200

// keep fork's default branch current with upstream (avoids stale-base PRs)
const base = await octokit.repos.getBranch({ ...UP, branch: "master" });
const baseSha = base.data.commit.sha;

// (b) create a branch on the fork off the current upstream HEAD
const branch = `erc7730/add-${slug}-${Date.now()}`;
await octokit.git.createRef({ ...FORK, ref: `refs/heads/${branch}`, sha: baseSha });

// (c) commit a new/updated file via the contents API (create-or-update)
let existingSha: string | undefined;
try {
  const cur = await octokit.repos.getContent({ ...FORK, path, ref: branch });
  if (!Array.isArray(cur.data) && "sha" in cur.data) existingSha = cur.data.sha; // required to UPDATE
} catch (e) { /* 404 = new file */ }

await octokit.repos.createOrUpdateFileContents({
  ...FORK,
  path,                                               // e.g. registry/foo/eip712-foo.json
  message: `feat(klarity): sync ${slug} from Arkiv\n\nArkiv-Entity: ${entityKey}\nArkiv-Origin: true`,
  content: Buffer.from(JSON.stringify(descriptor, null, 2)).toString("base64"),
  branch,
  sha: existingSha,                                   // omit for create, set for update
});

// (d) open the cross-repo PR to UPSTREAM
const pr = await octokit.pulls.create({
  ...UP,                                              // base repo in the URL path
  title: `Add/update ${slug} clear-signing descriptor`,
  head: `${BOT}:${branch}`,                           // cross-fork head = "owner:branch"
  base: "master",
  maintainer_can_modify: true,
  body: `Synced from Arkiv entity \`${entityKey}\`.\n\nProposed by authorized wallet \`${wallet}\`.`,
});
return pr.data.html_url;
```

Key facts confirmed from GitHub docs:
- PR is created on the **base** repo (`POST /repos/{baseOwner}/{baseRepo}/pulls`); `head` uses `user:branch` for cross-fork.
- `createOrUpdateFileContents` needs the existing blob `sha` to **update**, omit it to **create**.
- `createFork` is idempotent and asynchronous — returns the existing fork; poll `repos.get` on the fork before pushing if freshly created.

---

## 3. Auth — PAT vs GitHub App

| | Fine-grained PAT | GitHub App |
|---|---|---|
| Setup | minutes (create token, set env) | more steps (app, install, JWT→installation token) |
| Identity | tied to a user/bot account | its own bot identity ("…[bot]") |
| Scopes | repo Contents: RW, Pull requests: RW, (Fork: on user's repos) | installation perms: Contents RW, Pull requests RW, Webhooks |
| Rate limit | 5,000 req/hr (user) | 5,000+/hr per installation, scales |
| Token refresh | long-lived | short-lived installation tokens (auto-rotate) |

**Recommendation: fine-grained PAT on a dedicated bot GitHub account for the hackathon.** Scopes needed: **Contents: Read & Write**, **Pull requests: Read & Write** on the fork (and metadata read). Forking + cross-repo PR works fine with a PAT. Store as `GITHUB_TOKEN` env.

**Upgrade path:** wrap all GitHub calls behind one `GitHubClient` class that takes an `Octokit`. To move to a GitHub App later, only the Octokit construction changes (swap to `@octokit/auth-app` / `createAppAuth`); the sync logic is untouched. Webhook secret stays the same model either way.

---

## 4. Idempotency / loop-prevention

The danger: our PR merges → `pull_request merged` / `push` webhook fires → ingest re-writes the Arkiv entity → … Use **layered** defense:

1. **Content-hash guard (primary, source-agnostic).** Store a canonical hash of each descriptor (sorted-key JSON → sha256) in the DB. On ingest, if `hash(incomingFile) === storedHash`, it's a no-op — skip the write. This alone breaks the loop because a round-tripped file is byte-identical to what we already have. Make it robust by canonicalizing (stable key order, normalized whitespace) before hashing on **both** write and ingest.
2. **Provenance marker in commit/PR.** Put `Arkiv-Origin: true` + `Arkiv-Entity: <key>` in the commit message/PR body (shown above). On ingest, if the merge commit carries our marker, we already have that state — skip. (Belt-and-suspenders; #1 is the real guard since humans may squash/edit messages.)
3. **Delivery-id dedupe.** Persist processed `X-GitHub-Delivery` GUIDs (and for polling, the processed commit SHAs) so retried webhook deliveries don't double-apply.
4. **Source-of-truth field per entity.** Track `lastSyncedGitSha` and `lastSyncedHash` on the Arkiv entity/DB row; only mutate when the incoming hash differs AND the git sha is newer.

Net: hash comparison (#1) is the one that must exist; everything else is optimization.

---

## 5. Rate limits

- Authenticated REST: **5,000 requests/hour** (PAT user / per App installation). Secondary limits on burst + content-write concurrency.
- Polling budget: `compareCommitsWithBasehead` = 1 req/poll + 1 `getContent` per changed file. At 60 s polling that's ~60 req/hr baseline — negligible.
- Writes: one PR ≈ 5–7 requests (fork check, getBranch, createRef, getContent, createOrUpdate, pulls.create). Fine.
- Stay safe: read `x-ratelimit-remaining` / `x-ratelimit-reset` response headers; back off when low. Use `@octokit/plugin-throttling` + `plugin-retry` for automatic retry/backoff on 403/secondary limits.
- Avoid re-fetching unchanged blobs — the content-hash cache (#4 above) also cuts request volume.

---

## Decisions for the plan
- **Ingest:** polling via `compareCommitsWithBasehead` as default; webhook `push`/`pull_request` as optional fast-path, shared apply logic.
- **Egress:** fork-flow with `@octokit/rest`, cross-repo PR `head: "<bot>:<branch>"`.
- **Auth:** fine-grained PAT on a bot account; abstract behind `GitHubClient` for a clean GitHub App upgrade.
- **Loop guard:** canonical content-hash comparison is mandatory; provenance marker + delivery-id dedupe layered on top.
- **Resilience:** `@octokit/plugin-throttling` + `plugin-retry`.
