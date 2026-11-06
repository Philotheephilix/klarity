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

describe('POST /decode — tokenPath + byte-slice/index path ops (Task 5)', () => {
  const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'; // low 20 bytes of the token word
  const LAST_POOL = '0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc'; // low 20 bytes of the dex word

  // The real on-wire unoswap: token + dex addresses packed in the low bytes of a
  // uint256 word; amount + minReturn plain. All four args are uint256.
  const UNOSWAP_SIG =
    'unoswap(uint256 token, uint256 amount, uint256 minReturn, uint256 dex)';
  const TOKEN_WORD =
    BigInt('0x000000000000000000000000' + USDC.slice(2)); // 917551...704
  const DEX_WORD = BigInt(
    '0x18800000000000003b6d0340b4e16d0168e52d35cacd2c6185b44281ec28c9dc',
  );

  function unoswapCalldata() {
    return encodeFunctionData({
      abi: [
        {
          type: 'function',
          name: 'unoswap',
          stateMutability: 'nonpayable',
          inputs: [
            { name: 'token', type: 'uint256' },
            { name: 'amount', type: 'uint256' },
            { name: 'minReturn', type: 'uint256' },
            { name: 'dex', type: 'uint256' },
          ],
          outputs: [],
        },
      ],
      functionName: 'unoswap',
      args: [TOKEN_WORD, 1000000n, 445806868670795n, DEX_WORD],
    });
  }

  function unoswapRow() {
    return rowWithBody(
      { functionName: 'unoswap', contractName: '1inch', kind: 'calldata', intent: 'Swap' },
      {
        $id: 'unoswap',
        intent: 'Swap',
        __signature: UNOSWAP_SIG,
        fields: [
          {
            format: 'tokenAmount',
            label: 'Amount to Send',
            path: 'amount',
            params: { tokenPath: 'token.[-20:]' },
          },
          {
            format: 'tokenAmount',
            label: 'Minimum to Receive',
            path: 'minReturn',
            params: { nativeCurrencyAddress: ['0x0000000000000000000000000000000000000000'] },
          },
          { format: 'addressName', label: 'Last pool', path: 'dex.[-20:]' },
        ],
      },
    );
  }

  it('(a) resolves tokenPath byte-slice -> params.token; value unchanged', async () => {
    const app = buildServer(depsWithRow(unoswapRow()));
    const res = await app.inject({
      method: 'POST',
      url: '/decode',
      payload: { chainId: 1, contract: ONEINCH, calldata: unoswapCalldata() },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json() as Record<string, any>;
    const amount = json.fields.find((f: any) => f.label === 'Amount to Send');
    expect(amount.value).toBe('1000000');
    expect(amount.type).toBe('uint256');
    expect(amount.params.token).toBe(USDC);
    await app.close();
  });

  it('(b) resolves a path ending in byte-slice -> address value (Last pool)', async () => {
    const app = buildServer(depsWithRow(unoswapRow()));
    const res = await app.inject({
      method: 'POST',
      url: '/decode',
      payload: { chainId: 1, contract: ONEINCH, calldata: unoswapCalldata() },
    });
    const json = res.json() as Record<string, any>;
    const pool = json.fields.find((f: any) => f.label === 'Last pool');
    expect(pool.value).toBe(LAST_POOL);
    await app.close();
  });

  it('(b2) no tokenPath -> params.token stays unset (native amount)', async () => {
    const app = buildServer(depsWithRow(unoswapRow()));
    const res = await app.inject({
      method: 'POST',
      url: '/decode',
      payload: { chainId: 1, contract: ONEINCH, calldata: unoswapCalldata() },
    });
    const json = res.json() as Record<string, any>;
    const min = json.fields.find((f: any) => f.label === 'Minimum to Receive');
    expect(min.value).toBe('445806868670795');
    expect(min.params?.token).toBeUndefined();
    await app.close();
  });

  it('(c) byte-slice on an address(0)-packed word -> params.token unset (honest)', async () => {
    const row = rowWithBody(
      { functionName: 'unoswap', contractName: '1inch', kind: 'calldata', intent: 'Swap' },
      {
        $id: 'unoswap',
        intent: 'Swap',
        __signature: UNOSWAP_SIG,
        fields: [
          {
            format: 'tokenAmount',
            label: 'Amount to Send',
            path: 'amount',
            params: { tokenPath: 'token.[-20:]' },
          },
        ],
      },
    );
    const app = buildServer(depsWithRow(row));
    const calldata = encodeFunctionData({
      abi: [
        {
          type: 'function',
          name: 'unoswap',
          stateMutability: 'nonpayable',
          inputs: [
            { name: 'token', type: 'uint256' },
            { name: 'amount', type: 'uint256' },
            { name: 'minReturn', type: 'uint256' },
            { name: 'dex', type: 'uint256' },
          ],
          outputs: [],
        },
      ],
      functionName: 'unoswap',
      args: [0n, 1000000n, 1n, 1n], // token word packs address(0)
    });
    const res = await app.inject({
      method: 'POST',
      url: '/decode',
      payload: { chainId: 1, contract: ONEINCH, calldata },
    });
    const json = res.json() as Record<string, any>;
    const amount = json.fields.find((f: any) => f.label === 'Amount to Send');
    expect(amount.value).toBe('1000000');
    expect(amount.params?.token).toBeUndefined();
    await app.close();
  });

  it('(d) plain-name tokenPath -> params.token lowercased', async () => {
    const SIG = 'supplyWithPermit(address asset, uint256 amount)';
    const ASSET = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    const row = rowWithBody(
      { functionName: 'supplyWithPermit', contractName: 'Aave', kind: 'calldata', intent: 'Supply' },
      {
        $id: 'supplyWithPermit',
        intent: 'Supply',
        __signature: SIG,
        fields: [
          {
            format: 'tokenAmount',
            label: 'Amount',
            path: 'amount',
            params: { tokenPath: 'asset' },
          },
        ],
      },
    );
    const app = buildServer(depsWithRow(row));
    const calldata = encodeFunctionData({
      abi: [
        {
          type: 'function',
          name: 'supplyWithPermit',
          stateMutability: 'nonpayable',
          inputs: [
            { name: 'asset', type: 'address' },
            { name: 'amount', type: 'uint256' },
          ],
          outputs: [],
        },
      ],
      functionName: 'supplyWithPermit',
      args: [ASSET, 500n],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/decode',
      payload: { chainId: 1, contract: ONEINCH, calldata },
    });
    const json = res.json() as Record<string, any>;
    const amount = json.fields.find((f: any) => f.label === 'Amount');
    expect(amount.params.token).toBe(ASSET.toLowerCase());
    await app.close();
  });

  it('(e) @.to tokenPath -> params.token = request contract (lowercased)', async () => {
    const SIG = 'transfer(address to, uint256 value)';
    const row = rowWithBody(
      { functionName: 'transfer', contractName: 'ERC20', kind: 'calldata', intent: 'Transfer' },
      {
        $id: 'transfer',
        intent: 'Transfer',
        __signature: SIG,
        fields: [
          {
            format: 'tokenAmount',
            label: 'Amount',
            path: 'value',
            params: { tokenPath: '@.to' },
          },
        ],
      },
    );
    const app = buildServer(depsWithRow(row));
    const calldata = encodeFunctionData({
      abi: [
        {
          type: 'function',
          name: 'transfer',
          stateMutability: 'nonpayable',
          inputs: [
            { name: 'to', type: 'address' },
            { name: 'value', type: 'uint256' },
          ],
          outputs: [],
        },
      ],
      functionName: 'transfer',
      args: ['0x1111111111111111111111111111111111111111', 7n],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/decode',
      payload: { chainId: 1, contract: ONEINCH, calldata },
    });
    const json = res.json() as Record<string, any>;
    const amount = json.fields.find((f: any) => f.label === 'Amount');
    expect(amount.params.token).toBe(ONEINCH.toLowerCase());
    await app.close();
  });

  it('(f) index ops [0] and [-1] resolve on an address[] arg', async () => {
    const SIG = 'route(address[] path, uint256 amount)';
    const A0 = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    const A1 = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
    const row = rowWithBody(
      { functionName: 'route', contractName: 'DEX', kind: 'calldata', intent: 'Route' },
      {
        $id: 'route',
        intent: 'Route',
        __signature: SIG,
        fields: [
          { format: 'addressName', label: 'First', path: 'path.[0]' },
          { format: 'addressName', label: 'Last', path: 'path.[-1]' },
        ],
      },
    );
    const app = buildServer(depsWithRow(row));
    const calldata = encodeFunctionData({
      abi: [
        {
          type: 'function',
          name: 'route',
          stateMutability: 'nonpayable',
          inputs: [
            { name: 'path', type: 'address[]' },
            { name: 'amount', type: 'uint256' },
          ],
          outputs: [],
        },
      ],
      functionName: 'route',
      args: [[A0, A1], 3n],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/decode',
      payload: { chainId: 1, contract: ONEINCH, calldata },
    });
    const json = res.json() as Record<string, any>;
    const first = json.fields.find((f: any) => f.label === 'First');
    const last = json.fields.find((f: any) => f.label === 'Last');
    expect(first.value).toBe(A0);
    expect(last.value).toBe(A1);
    await app.close();
  });
});
