import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeDescriptor } from '../../src/normalize/normalize.js';
import { selectorOf } from '../../src/normalize/selector.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

function loadFragment(relPath: string, fromPath: string): Record<string, unknown> {
  const abs = resolve(dirname(fromPath), relPath);
  return JSON.parse(readFileSync(abs, 'utf8')) as Record<string, unknown>;
}
function read(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIX, name), 'utf8')) as Record<string, unknown>;
}

describe('normalizeDescriptor — calldata (Aave multi-deploy)', () => {
  const doc = read('aave-calldata-multideploy.json');
  const sourcePath = 'registry/aave/aave-calldata-multideploy.json';
  const records = normalizeDescriptor(doc, sourcePath, { loadFragment, fromPath: join(FIX, 'aave-calldata-multideploy.json') });

  it('emits #deployments * #formats records (12 * 5 = 60)', () => {
    expect(records.length).toBe(60);
  });

  it('every record is calldata, lowercased contract, correct selector', () => {
    for (const r of records) {
      expect(r.kind).toBe('calldata');
      expect(r.contract).toBe(r.contract.toLowerCase());
      expect(r.selector).toMatch(/^0x[0-9a-f]{8}$/);
      expect(r.selector).toBe(selectorOf(r.functionSignature));
      expect(r.entityName).toBe('aave');
      expect(r.owner).toBe('Aave DAO');
      expect(r.schemaVersion).toContain('erc7730-v2');
    }
  });

  it('a known selector/intent lands (depositETH -> Supply-ish)', () => {
    const dep = records.find((r) => r.functionName === 'depositETH');
    expect(dep).toBeDefined();
    expect(dep!.functionSignature).toBe('depositETH(address,address,uint16)');
    expect(dep!.selector).toBe(selectorOf('depositETH(address,address,uint16)'));
    expect(typeof dep!.intent).toBe('string');
  });
});

describe('normalizeDescriptor — $ref inlining (OKX)', () => {
  const doc = read('okx-ref-definitions.json');
  const records = normalizeDescriptor(doc, 'registry/okx/okx-ref-definitions.json', {
    loadFragment,
    fromPath: join(FIX, 'okx-ref-definitions.json'),
  });

  it('no "$ref" string remains in any formatBlock', () => {
    expect(records.length).toBeGreaterThan(0);
    for (const r of records) {
      expect(JSON.stringify(r.formatBlock)).not.toContain('$ref');
    }
  });

  it('a referenced definition got inlined (tokenAmount format present)', () => {
    const r = records.find((x) => x.functionName === 'dagSwapByOrderId');
    expect(r).toBeDefined();
    const fields = (r!.formatBlock as any).fields as Array<Record<string, unknown>>;
    const inlined = fields.find((f) => f.path === 'baseRequest.minReturnAmount');
    expect(inlined).toBeDefined();
    expect(inlined!.format).toBe('tokenAmount'); // from definition
    expect('$ref' in inlined!).toBe(false);
  });
});

describe('normalizeDescriptor — eip712 (Safe multi-deploy via includes)', () => {
  const doc = read('safe-eip712-multideploy.json');
  const records = normalizeDescriptor(doc, 'registry/safe/safe-eip712-multideploy.json', {
    loadFragment,
    fromPath: join(FIX, 'safe-eip712-multideploy.json'),
  });

  it('emits 68 deployments * 1 format = 68 records, all eip712', () => {
    expect(records.length).toBe(68);
    for (const r of records) expect(r.kind).toBe('eip712');
  });

  it('eip712PrimaryType set and functionName === primaryType', () => {
    for (const r of records) {
      expect(r.eip712PrimaryType).toBeDefined();
      expect(r.eip712PrimaryType!.startsWith('SafeTx(')).toBe(true);
      expect(r.functionName).toBe(r.eip712PrimaryType);
      expect(r.functionSignature).toBe(r.eip712PrimaryType);
      expect(r.selector).toMatch(/^0x[0-9a-f]{8}$/);
    }
  });
});

describe('normalizeDescriptor — includes with own context (Safe migration)', () => {
  const doc = read('safe-migration-2level.json');
  const records = normalizeDescriptor(doc, 'registry/safe/safe-migration-2level.json', {
    loadFragment,
    fromPath: join(FIX, 'safe-migration-2level.json'),
  });
  it('resolves the fragment formats (7 deploys * 4 formats = 28)', () => {
    expect(records.length).toBe(28);
    for (const r of records) expect(r.kind).toBe('calldata');
    expect(records.some((r) => r.functionName === 'migrateSingleton')).toBe(true);
  });
});

describe('normalizeDescriptor — no-arg functions (Celo)', () => {
  const doc = read('celo-noarg.json');
  const records = normalizeDescriptor(doc, 'registry/celo/celo-noarg.json', {
    loadFragment,
    fromPath: join(FIX, 'celo-noarg.json'),
  });
  it('a no-arg function gets a valid selector', () => {
    const r = records.find((x) => x.functionName === 'createAccount');
    expect(r).toBeDefined();
    expect(r!.functionSignature).toBe('createAccount()');
    expect(r!.selector).toBe(selectorOf('createAccount()'));
  });
});
