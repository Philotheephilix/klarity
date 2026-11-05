import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveIncludes } from '../../src/normalize/includes.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

// I/O stays in the test (caller injects loadFragment); the module is pure.
function loadFragment(relPath: string, fromPath: string): Record<string, unknown> {
  const abs = resolve(dirname(fromPath), relPath);
  return JSON.parse(readFileSync(abs, 'utf8')) as Record<string, unknown>;
}

function readFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIX, name), 'utf8')) as Record<string, unknown>;
}

describe('resolveIncludes', () => {
  it('DAI permit (no own formats) resolves to a doc WITH formats from the fragment', () => {
    const from = join(FIX, 'dai-permit-includes.json');
    const doc = readFixture('dai-permit-includes.json');
    const resolved = resolveIncludes(doc, loadFragment, from) as any;
    const keys = Object.keys(resolved.display?.formats ?? {});
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.some((k) => k.startsWith('Permit('))).toBe(true);
    // self context (eip712 deployments + domain) is preserved
    expect(resolved.context.eip712.deployments[0].chainId).toBe(1);
    expect(resolved.context.eip712.domain.name).toBe('Dai Stablecoin');
    // no residual `includes` key
    expect('includes' in resolved).toBe(false);
  });

  it('resolves a synthetic 2-level include chain fully, self wins at each level', () => {
    const from = join(FIX, 'synthetic-level0.json');
    const doc = readFixture('synthetic-level0.json');
    const resolved = resolveIncludes(doc, loadFragment, from) as any;
    expect(resolved.level0Key).toBe('from-level0');
    expect(resolved.level1Key).toBe('from-level1');
    expect(resolved.level2Key).toBe('from-level2');
    // the including doc (level0) wins over the merged fragments
    expect(resolved.overrideKey).toBe('level0-wins');
    // deepest fragment's formats bubble all the way up
    expect(resolved.display.formats['deepest()'].intent).toBe('FromLevel2');
    expect('includes' in resolved).toBe(false);
  });

  it('self keys override fragment keys (deep merge, self wins)', () => {
    const fragment = { a: 1, nested: { x: 'frag', y: 'frag' } };
    const self = { includes: 'frag.json', a: 2, nested: { x: 'self' } };
    const load = () => fragment;
    const resolved = resolveIncludes(self, load, '/tmp/self.json') as any;
    expect(resolved.a).toBe(2); // self wins
    expect(resolved.nested.x).toBe('self'); // self wins (deep)
    expect(resolved.nested.y).toBe('frag'); // fragment-only key kept
  });

  it('arrays are replaced, not merged', () => {
    const fragment = { arr: [1, 2, 3] };
    const self = { includes: 'frag.json', arr: [9] };
    const resolved = resolveIncludes(self, () => fragment, '/tmp/self.json') as any;
    expect(resolved.arr).toEqual([9]);
  });

  it('throws when include depth exceeds the cap', () => {
    // a fragment that always includes itself -> runaway recursion
    const loopFragment = { includes: 'loop.json', k: 'v' };
    expect(() => resolveIncludes(loopFragment, () => loopFragment, '/tmp/x.json')).toThrow();
  });
});
