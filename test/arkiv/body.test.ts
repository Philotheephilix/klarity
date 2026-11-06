import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import canonicalizeModule from 'canonicalize';
import { toValues } from '../../src/arkiv/schema.js';
import { descriptorHash } from '../../src/hash.js';
import type { EntityRecord } from '../../src/normalize/types.js';

const canonicalize = canonicalizeModule as unknown as (input: unknown) => string;

const CONTENT_HASH =
  '0x1111111111111111111111111111111111111111111111111111111111111111';

// The real largest formatBlock emitted by the normalizer over
// registry/morpho/calldata-MidnightBundlesV2.json (~6.4 KB canonical).
const fixturePath = fileURLToPath(
  new URL('../fixtures/largest-body.json', import.meta.url),
);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Record<
  string,
  unknown
>;

/** A record carrying the given formatBlock; identity fields are fixed. */
function recWith(formatBlock: Record<string, unknown>): EntityRecord {
  return {
    chainId: 1,
    contract: '0xabcabcabcabcabcabcabcabcabcabcabcabcabca',
    selector: '0xdeadbeef',
    functionName: 'multicall',
    functionSignature: 'multicall(bytes[])',
    kind: 'calldata',
    intent: 'Bundle',
    entityName: 'morpho',
    contractName: 'MidnightBundlesV2',
    owner: 'Morpho',
    sourcePath: 'registry/morpho/calldata-MidnightBundlesV2.json',
    schemaVersion: 'https://schemas.example/erc7730-v2',
    formatBlock,
  };
}

describe('body round-trip with the real largest fixture', () => {
  it('fixture is the real ~6.4 KB maximum body', () => {
    const bytes = Buffer.byteLength(canonicalize(fixture), 'utf8');
    expect(bytes).toBeGreaterThan(6000);
    expect(bytes).toBeLessThan(7000);
  });

  it('bodyHash equals descriptorHash(formatBlock)', () => {
    const values = toValues(recWith(fixture), {
      source: 'github-sync',
      contentHash: CONTENT_HASH,
    });
    const bodyHash = values.bodyHash as { type: 'str'; value: string };
    expect(bodyHash.value).toBe(descriptorHash(fixture));
  });

  it('round-trips byte-exact through the read path (hex -> utf8 -> JSON)', () => {
    const values = toValues(recWith(fixture), {
      source: 'github-sync',
      contentHash: CONTENT_HASH,
    });
    const bodyHash = values.bodyHash as { type: 'str'; value: string };

    // The body column is stored as the canonical UTF-8 bytes; Arkiv reads a
    // `bytes` column back as a `0x…` hex string. Reproduce that hex here.
    const hex = '0x' + Buffer.from(canonicalize(fixture), 'utf8').toString('hex');

    // Mirror src/routes/query.ts decode: hex -> utf8 -> JSON.parse.
    const json = Buffer.from(hex.slice(2), 'hex').toString('utf8');
    const decoded = JSON.parse(json) as Record<string, unknown>;

    expect(decoded).toEqual(fixture);
    expect(descriptorHash(decoded)).toBe(bodyHash.value);
  });
});

describe('oversized-body guard', () => {
  it('toValues throws a typed error naming the descriptor identity', () => {
    const rec = recWith({ intent: 'Huge', blob: 'x'.repeat(140000) });
    let caught: unknown;
    try {
      toValues(rec, { source: 'github-sync', contentHash: CONTENT_HASH });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    // Must name chainId/contract/selector so the failure is traceable.
    expect(message).toContain(
      `${rec.chainId}/${rec.contract}/${rec.selector}`,
    );
  });

  it('does not throw for the real largest body (guard has headroom)', () => {
    expect(() =>
      toValues(recWith(fixture), {
        source: 'github-sync',
        contentHash: CONTENT_HASH,
      }),
    ).not.toThrow();
  });
});
