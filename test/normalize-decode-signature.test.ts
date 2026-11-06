import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeFunctionData, getAddress } from 'viem';
import { normalizeDescriptor } from '../src/normalize/normalize.js';
import { canonicalHash } from '../src/hash.js';
import { buildServer, type ServerDeps } from '../src/server.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadFragment(relPath: string, fromPath: string): Record<string, unknown> {
  const abs = resolve(dirname(fromPath), relPath);
  return JSON.parse(readFileSync(abs, 'utf8')) as Record<string, unknown>;
}
function read(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIX, name), 'utf8')) as Record<string, unknown>;
}

// The raw ERC-7730 format-block key for depositETH — parameter names preserved.
const RAW_KEY = 'depositETH(address pool, address onBehalfOf, uint16 referralCode)';

function depsWithRow(row: Record<string, unknown> | null): ServerDeps {
  const arkiv = {
    queryOne: vi.fn(async () => row),
    queryOneWithBody: vi.fn(async () => row),
    queryMany: vi.fn(async () => []),
  };
  return {
    arkiv,
    github: {},
    db: {},
    config: { authorizedWallets: new Set<string>() },
    attester: undefined,
  } as unknown as ServerDeps;
}

// Build a body-bearing row in the SDK envelope shape straight from a REAL
// normalized formatBlock (so the __signature is whatever the normalizer stored,
// not a hand-injected value).
function rowFromFormatBlock(
  cols: Record<string, string>,
  formatBlock: Record<string, unknown>,
): Record<string, unknown> {
  const { canonical, hash } = canonicalHash(formatBlock);
  const hex = '0x' + Buffer.from(canonical, 'utf8').toString('hex');
  const row: Record<string, unknown> = {
    $key: '0xkey',
    body: { type: 'bytes', value: hex },
    bodyHash: { type: 'str', value: hash },
  };
  for (const [k, v] of Object.entries(cols)) row[k] = { type: 'str', value: v };
  return row;
}

describe('Task 1b — name-bearing signature persisted through the real normalizer', () => {
  const doc = read('aave-calldata-multideploy.json');
  const records = normalizeDescriptor(doc, 'registry/aave/aave-calldata-multideploy.json', {
    loadFragment,
    fromPath: join(FIX, 'aave-calldata-multideploy.json'),
  });
  const dep = records.find((r) => r.functionName === 'depositETH');

  it('normalizer stores the raw name-bearing key in the formatBlock body as __signature', () => {
    expect(dep).toBeDefined();
    // The existing name-STRIPPED signature stays as-is (coexists).
    expect(dep!.functionSignature).toBe('depositETH(address,address,uint16)');
    // The new reserved field carries the name-bearing key.
    expect((dep!.formatBlock as Record<string, unknown>)['__signature']).toBe(RAW_KEY);
  });

  it('/decode resolves a NAMED path (onBehalfOf) to a concrete value+type via the stored __signature', async () => {
    const CONTRACT = '0xd01607c3C5eCABa394D8be377a08590149325722'.toLowerCase();
    const ONBEHALF = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC addr, used as recipient
    const POOL = '0x1111111111111111111111111111111111111111';

    const calldata = encodeFunctionData({
      abi: [
        {
          type: 'function',
          name: 'depositETH',
          stateMutability: 'nonpayable',
          inputs: [
            { name: 'pool', type: 'address' },
            { name: 'onBehalfOf', type: 'address' },
            { name: 'referralCode', type: 'uint16' },
          ],
          outputs: [],
        },
      ],
      functionName: 'depositETH',
      args: [POOL, ONBEHALF, 7],
    });

    const row = rowFromFormatBlock(
      {
        functionName: 'depositETH',
        contractName: 'WrappedTokenGatewayV3',
        kind: 'calldata',
        intent: 'Supply',
      },
      dep!.formatBlock,
    );

    const app = buildServer(depsWithRow(row));
    const res = await app.inject({
      method: 'POST',
      url: '/decode',
      payload: { chainId: 1, contract: CONTRACT, calldata },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json() as Record<string, any>;

    // Top-level + signing functionSignature populated from the body signature.
    expect(json.signing.functionSignature || json.functionSignature).toBe(RAW_KEY);

    // The named path onBehalfOf (visible field) resolves to the decoded address.
    const onBehalf = json.fields.find((f: any) => f.path === 'onBehalfOf');
    expect(onBehalf).toBeDefined();
    expect(onBehalf.value).toBe(getAddress(ONBEHALF));
    expect(onBehalf.type).toBe('address');

    // A hidden named path resolves too.
    const ref = json.hiddenFields.find((f: any) => f.path === 'referralCode');
    expect(ref.value).toBe('7');
    expect(ref.type).toBe('uint16');

    await app.close();
  });
});
