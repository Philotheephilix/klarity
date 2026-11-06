import { describe, it, expect, vi } from 'vitest';
import { encodeFunctionData } from 'viem';
import { buildServer, type ServerDeps } from '../src/server.js';
import { canonicalHash } from '../src/hash.js';

// --- Minimal deps bundle: only arkiv.queryOneWithBody matters for /decode. ---
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

// Build a body-bearing descriptor row in the SDK envelope shape: indexed
// columns are { type, value }; the body is hex-encoded canonical JSON of the
// format block with its matching bodyHash.
function rowWithBody(
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

const ONEINCH = '0x111111125421ca6dc452d289314280a0f8842a65';

describe('POST /decode — ABI value-decode (Task 1)', () => {
  // The stored functionSignature is the canonical signature with parameter
  // NAMES preserved (so named ERC-7730 paths resolve). It lives inside the body
  // under the reserved `__signature` field (not an indexed column) — this is
  // what lets the route map decoded positional args onto each field's `path`.
  const SIG = 'unoswap(address srcToken, uint256 amount, uint256 minReturn, uint256 pool)';

  function unoswapRow() {
    return rowWithBody(
      {
        functionName: 'unoswap',
        contractName: '1inch',
        kind: 'calldata',
        intent: 'Swap',
      },
      {
        $id: 'unoswap',
        intent: 'Swap',
        __signature: SIG,
        fields: [
          { format: 'addressName', label: 'Token', path: 'srcToken' },
          { format: 'amount', label: 'Amount', path: 'amount' },
          { format: 'amount', label: 'Min return', path: 'minReturn', visible: 'never' },
          { label: 'Pool', path: 'pool', visible: 'never' },
        ],
      },
    );
  }

  const TOKEN = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC
  function unoswapCalldata() {
    return encodeFunctionData({
      abi: [
        {
          type: 'function',
          name: 'unoswap',
          stateMutability: 'nonpayable',
          inputs: [
            { name: 'srcToken', type: 'address' },
            { name: 'amount', type: 'uint256' },
            { name: 'minReturn', type: 'uint256' },
            { name: 'pool', type: 'uint256' },
          ],
          outputs: [],
        },
      ],
      functionName: 'unoswap',
      args: [TOKEN, 1000000n, 990000n, 42n],
    });
  }

  it('maps decoded arg values + types onto named fields and drops the note', async () => {
    const app = buildServer(depsWithRow(unoswapRow()));
    const res = await app.inject({
      method: 'POST',
      url: '/decode',
      payload: { chainId: 1, contract: ONEINCH, calldata: unoswapCalldata() },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json() as Record<string, any>;

    // functionSignature surfaced on the response.
    expect(json.signing.functionSignature || json.functionSignature).toBe(SIG);

    // Visible fields carry decoded value + ABI type.
    const amount = json.fields.find((f: any) => f.path === 'amount');
    expect(amount).toBeDefined();
    expect(amount.value).toBe('1000000');
    expect(amount.type).toBe('uint256');

    const token = json.fields.find((f: any) => f.path === 'srcToken');
    expect(token).toBeDefined();
    // Address returned checksummed.
    expect(token.value).toBe(TOKEN);
    expect(token.type).toBe('address');

    // Hidden fields are value-decoded too.
    const pool = json.hiddenFields.find((f: any) => f.path === 'pool');
    expect(pool.value).toBe('42');
    expect(pool.type).toBe('uint256');

    // The hardcoded "not ABI-decoded" note is gone once values are present.
    expect(json.note || '').not.toContain('not ABI-decoded');

    await app.close();
  });

  it('leaves values unset (labels-only) and keeps a note when functionSignature is absent', async () => {
    const row = rowWithBody(
      { functionName: 'unoswap', contractName: '1inch', kind: 'calldata', intent: 'Swap' },
      {
        $id: 'unoswap',
        intent: 'Swap',
        fields: [{ format: 'amount', label: 'Amount', path: 'amount' }],
      },
    );
    const app = buildServer(depsWithRow(row));
    const res = await app.inject({
      method: 'POST',
      url: '/decode',
      payload: { chainId: 1, contract: ONEINCH, calldata: unoswapCalldata() },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json() as Record<string, any>;
    expect(json.fields[0].value).toBeUndefined();
    expect(json.fields[0].type).toBeUndefined();
    expect(json.note).toContain('not ABI-decoded');
    await app.close();
  });

  it('never 500s on a decode failure: garbage calldata vs the stored signature', async () => {
    const app = buildServer(depsWithRow(unoswapRow()));
    // Valid selector shape but truncated args -> ABI decode throws; must be swallowed.
    const res = await app.inject({
      method: 'POST',
      url: '/decode',
      payload: { chainId: 1, contract: ONEINCH, calldata: '0x12345678' + 'ab'.repeat(10) },
    });
    // Selector won't match unoswap's; but even a length mismatch must not 500.
    expect(res.statusCode).not.toBe(500);
    await app.close();
  });
});
