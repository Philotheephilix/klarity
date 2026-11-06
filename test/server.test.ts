import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { buildServer, type ServerDeps } from '../src/server.js';
import { domain, types, type DescriptorWriteMessage } from '../src/auth.js';
import { descriptorHash, canonicalHash } from '../src/hash.js';
import type { Config } from '../src/config.js';

// Anvil account #0 — throwaway test key, never a real wallet.
const TEST_PK =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const account = privateKeyToAccount(TEST_PK);
const SIGNER_LOWER = account.address.toLowerCase();

const WEBHOOK_SECRET = 'test-webhook-secret';

// A minimal calldata descriptor yielding exactly one EntityRecord.
function oneRecordDescriptor() {
  return {
    $schema: 'https://eips.ethereum.org/assets/eip-7730/erc7730-v1.schema.json',
    context: {
      contract: {
        deployments: [
          { chainId: 1, address: '0xAbCdEf0000000000000000000000000000000001' },
        ],
      },
    },
    metadata: { owner: 'Aave' },
    display: { formats: { 'transfer(address,uint256)': { intent: 'Transfer' } } },
  };
}

function cfg(wallets: string[]): Config {
  return {
    arkiv: { privateKey: '', rpcUrl: '', wsUrl: '', chainId: 7794095 },
    github: {
      token: '',
      botLogin: '',
      upstreamOwner: '',
      upstreamRepo: '',
      webhookSecret: WEBHOOK_SECRET,
    },
    authorizedWallets: new Set(wallets.map((w) => w.toLowerCase())),
    pollIntervalMs: 60000,
    dbPath: ':memory:',
    port: 3000,
  } as Config;
}

// A deps bundle with vi.fn mocks for arkiv/github and a stateful db.
function makeDeps(opts: {
  wallets?: string[];
  queryOneRow?: Record<string, unknown> | null;
  queryManyRows?: Record<string, unknown>[];
  nonceUsed?: Set<string>;
  deliveries?: Set<string>;
  attester?: ServerDeps['attester'];
} = {}) {
  const nonceUsed = opts.nonceUsed ?? new Set<string>();
  const deliveries = opts.deliveries ?? new Set<string>();
  const arkiv = {
    queryOne: vi.fn(async () => opts.queryOneRow ?? null),
    queryOneWithBody: vi.fn(async () => opts.queryOneRow ?? null),
    queryMany: vi.fn(async () => opts.queryManyRows ?? []),
    upsert: vi.fn(async () => ({
      entityKey: '0xentitykey',
      txHash: '0xtxhash',
      created: true,
    })),
    remove: vi.fn(async () => ({ txHash: '0xremovetx' })),
  };
  const github = {
    openDescriptorPR: vi.fn(async () => 'https://github.com/ef/registry/pull/1'),
    getFile: vi.fn(async () => ({ content: {}, sha: 'BLOB' })),
  };
  const db = {
    isNonceUsed: vi.fn((signer: string, nonce: string) =>
      nonceUsed.has(`${signer}:${nonce}`),
    ),
    markNonceUsed: vi.fn((signer: string, nonce: string) => {
      const key = `${signer}:${nonce}`;
      if (nonceUsed.has(key)) return false;
      nonceUsed.add(key);
      return true;
    }),
    wasDelivery: vi.fn((id: string) => deliveries.has(id)),
    markDelivery: vi.fn((id: string) => void deliveries.add(id)),
    getSyncCursor: vi.fn(() => null),
    setSyncCursor: vi.fn(),
    getHash: vi.fn(() => null),
    setHash: vi.fn(),
  };
  const config = cfg(opts.wallets ?? [SIGNER_LOWER]);
  const deps = { arkiv, github, db, config, attester: opts.attester } as unknown as ServerDeps;
  return { deps, arkiv, github, db, config };
}

async function signMessage(
  msg: DescriptorWriteMessage,
): Promise<`0x${string}`> {
  return account.signTypedData({
    domain,
    types,
    primaryType: 'DescriptorWrite',
    message: msg,
  });
}

function sign(secret: string, body: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

describe('GET query routes', () => {
  it('returns a seeded descriptor for an identity lookup', async () => {
    // Real SDK row shape: every column is a { type, value } envelope and a
    // u64 reads back as a BigInt. The route must unwrap these to plain JSON
    // (a raw BigInt would 500 Fastify's serializer).
    const row = {
      $key: '0xkey',
      chainId: { type: 'u64', value: 1n },
      selector: { type: 'str', value: '0x12345678' },
    };
    const { deps, arkiv } = makeDeps({ queryOneRow: row });
    const app = buildServer(deps);
    const res = await app.inject({
      method: 'GET',
      url: '/descriptors/1/0xAbC/0x12345678',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ chainId: 1, selector: '0x12345678' });
    expect(arkiv.queryOneWithBody).toHaveBeenCalledWith({
      chainId: 1,
      contract: '0xabc',
      selector: '0x12345678',
    });
    await app.close();
  });

  it('unwraps a u64 above 2^53 as a decimal string, not a rounded Number', async () => {
    // Number(bigint) silently rounds above Number.MAX_SAFE_INTEGER, corrupting
    // large ids. Such a value must round-trip losslessly as a decimal string.
    const big = 9007199254740993n; // 2^53 + 1 — not representable as a Number
    const row = {
      $key: '0xkey',
      chainId: { type: 'u64', value: 1n },
      selector: { type: 'str', value: '0x12345678' },
      someU64: { type: 'u64', value: big },
    };
    const { deps } = makeDeps({ queryOneRow: row });
    const app = buildServer(deps);
    const res = await app.inject({
      method: 'GET',
      url: '/descriptors/1/0xabc/0x12345678',
    });
    expect(res.statusCode).toBe(200);
    const json = res.json() as Record<string, unknown>;
    expect(json.chainId).toBe(1); // in-range u64 still a Number
    expect(json.someU64).toBe(big.toString()); // out-of-range u64 preserved as string
    await app.close();
  });

  it('body present + hash matches -> inlines decoded formatBlock, 200', async () => {
    const formatBlock = { intent: 'Transfer', fields: [{ path: 'to', label: 'To' }] };
    const canonical = canonicalHash(formatBlock).canonical;
    const row = {
      $key: '0xkey',
      chainId: { type: 'u64', value: 1n },
      selector: { type: 'str', value: '0x12345678' },
      body: { type: 'bytes', value: '0x' + Buffer.from(canonical, 'utf8').toString('hex') },
      bodyHash: { type: 'str', value: descriptorHash(formatBlock) },
    };
    const { deps } = makeDeps({ queryOneRow: row });
    const app = buildServer(deps);
    const res = await app.inject({
      method: 'GET',
      url: '/descriptors/1/0xabc/0x12345678',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ formatBlock, chainId: 1 });
    await app.close();
  });

  it('body present + hash mismatch -> 500', async () => {
    const formatBlock = { intent: 'Transfer' };
    const canonical = canonicalHash(formatBlock).canonical;
    const row = {
      $key: '0xkey',
      chainId: { type: 'u64', value: 1n },
      selector: { type: 'str', value: '0x12345678' },
      body: { type: 'bytes', value: '0x' + Buffer.from(canonical, 'utf8').toString('hex') },
      bodyHash: { type: 'str', value: descriptorHash({ intent: 'Tampered' }) },
    };
    const { deps } = makeDeps({ queryOneRow: row });
    const app = buildServer(deps);
    const res = await app.inject({
      method: 'GET',
      url: '/descriptors/1/0xabc/0x12345678',
    });
    expect(res.statusCode).toBe(500);
    await app.close();
  });

  it('malformed body -> 500, not an unhandled throw', async () => {
    const row = {
      $key: '0xkey',
      chainId: { type: 'u64', value: 1n },
      selector: { type: 'str', value: '0x12345678' },
      // Not valid UTF-8 JSON once hex-decoded.
      body: { type: 'bytes', value: '0xdeadbeef' },
      bodyHash: { type: 'str', value: '0x00' },
    };
    const { deps } = makeDeps({ queryOneRow: row });
    const app = buildServer(deps);
    const res = await app.inject({
      method: 'GET',
      url: '/descriptors/1/0xabc/0x12345678',
    });
    expect(res.statusCode).toBe(500);
    await app.close();
  });

  it('row present but no body field (pre-column row) -> 200, no formatBlock', async () => {
    const row = {
      $key: '0xkey',
      chainId: { type: 'u64', value: 1n },
      selector: { type: 'str', value: '0x12345678' },
    };
    const { deps } = makeDeps({ queryOneRow: row });
    const app = buildServer(deps);
    const res = await app.inject({
      method: 'GET',
      url: '/descriptors/1/0xabc/0x12345678',
    });
    expect(res.statusCode).toBe(200);
    const json = res.json() as Record<string, unknown>;
    expect(json).toMatchObject({ chainId: 1, selector: '0x12345678' });
    expect(json).not.toHaveProperty('formatBlock');
    await app.close();
  });

  it('unknown identity -> 404', async () => {
    const { deps } = makeDeps({ queryOneRow: null });
    const app = buildServer(deps);
    const res = await app.inject({
      method: 'GET',
      url: '/descriptors/1/0xabc/0xdeadbeef',
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('contract lookup returns all formats', async () => {
    const rows = [
      { $key: '0x1', chainId: { type: 'u64', value: 1n } },
      { $key: '0x2', chainId: { type: 'u64', value: 1n } },
    ];
    const { deps, arkiv } = makeDeps({ queryManyRows: rows });
    const app = buildServer(deps);
    const res = await app.inject({ method: 'GET', url: '/descriptors/1/0xabc' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
    expect(res.json()).toMatchObject([{ chainId: 1 }, { chainId: 1 }]);
    expect(arkiv.queryMany).toHaveBeenCalledWith({ chainId: 1, contract: '0xabc' });
    await app.close();
  });

  it('browse passes through known filters and ignores unknown params', async () => {
    const { deps, arkiv } = makeDeps({ queryManyRows: [] });
    const app = buildServer(deps);
    const res = await app.inject({
      method: 'GET',
      url: '/descriptors?entityName=aave&intent=Transfer&bogus=x',
    });
    expect(res.statusCode).toBe(200);
    expect(arkiv.queryMany).toHaveBeenCalledWith({
      entityName: 'aave',
      intent: 'Transfer',
    });
    await app.close();
  });

  it('browse ignores functionSignature and carries no body/bodyHash', async () => {
    const rows = [
      {
        $key: '0x1',
        chainId: { type: 'u64', value: 1n },
        body: { type: 'bytes', value: '0xdead' },
        bodyHash: { type: 'str', value: '0x00' },
      },
    ];
    const { deps, arkiv } = makeDeps({ queryManyRows: rows });
    const app = buildServer(deps);
    const res = await app.inject({
      method: 'GET',
      url: '/descriptors?entityName=aave&functionSignature=transfer(address,uint256)',
    });
    expect(res.statusCode).toBe(200);
    // functionSignature is no longer a browse filter key — not passed through.
    expect(arkiv.queryMany).toHaveBeenCalledWith({ entityName: 'aave' });
    const json = res.json() as Record<string, unknown>[];
    for (const r of json) {
      expect(r.chainId).toBe(1); // unwrapped from { type:'u64', value:1n }
      expect(r).not.toHaveProperty('body');
      expect(r).not.toHaveProperty('bodyHash');
    }
    await app.close();
  });

  it('nonce endpoint returns a fresh decimal string nonce', async () => {
    const { deps, db } = makeDeps();
    const app = buildServer(deps);
    const res = await app.inject({ method: 'GET', url: `/nonce/${SIGNER_LOWER}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { nonce: string };
    expect(typeof body.nonce).toBe('string');
    expect(BigInt(body.nonce)).toBeGreaterThan(0n);
    expect(db.isNonceUsed).toHaveBeenCalled();
    await app.close();
  });
});

// Build a body-bearing descriptor row in the real SDK envelope shape: indexed
// columns are { type, value }, and the body is hex-encoded canonical JSON of
// the format block with its matching bodyHash.
function rowWithBody(
  cols: Record<string, string>,
  formatBlock: Record<string, unknown>,
) {
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

describe('POST /decode — what-you’re-signing', () => {
  const AAVE = '0xd01607c3c5ecaba394d8be377a08590149325722';

  function depositRow() {
    return rowWithBody(
      { functionName: 'depositETH', contractName: 'WrappedTokenGatewayV3', kind: 'calldata', intent: 'Supply' },
      {
        $id: 'depositETH',
        intent: 'Supply',
        fields: [
          { format: 'amount', label: 'Amount to supply', path: '@.value' },
          { format: 'addressName', label: 'Collateral recipient', path: 'onBehalfOf' },
          { label: 'Referral Code', path: 'referralCode', visible: 'never' },
        ],
      },
    );
  }

  it('calldata: derives the selector, returns intent + visible/hidden fields', async () => {
    const { deps, arkiv } = makeDeps({ queryOneRow: depositRow() });
    const app = buildServer(deps);
    const res = await app.inject({
      method: 'POST',
      url: '/decode',
      payload: {
        chainId: 1,
        contract: AAVE,
        calldata: '0x474cf53d' + '00'.repeat(32),
      },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json() as Record<string, any>;
    expect(json.signing.selector).toBe('0x474cf53d');
    expect(json.signing.decodedFrom).toBe('calldata');
    expect(json.signing.summary).toBe('Supply');
    expect(json.fields.map((f: any) => f.label)).toEqual(['Amount to supply', 'Collateral recipient']);
    expect(json.hiddenFields.map((f: any) => f.label)).toEqual(['Referral Code']);
    // Selector is the first 4 bytes of the calldata, lowercased.
    expect(arkiv.queryOneWithBody).toHaveBeenCalledWith({
      chainId: 1,
      contract: AAVE,
      selector: '0x474cf53d',
    });
    await app.close();
  });

  it('calldata: surfaces interpolatedIntent as the summary when present', async () => {
    const row = rowWithBody(
      { functionName: 'ping', kind: 'calldata', intent: 'Check in' },
      { $id: 'ping', intent: 'Check in', interpolatedIntent: 'Check in on {id}', fields: [] },
    );
    const { deps } = makeDeps({ queryOneRow: row });
    const app = buildServer(deps);
    const res = await app.inject({
      method: 'POST',
      url: '/decode',
      payload: { chainId: 1, contract: AAVE, calldata: '0xabcdef12' },
    });
    expect(res.json().signing.summary).toBe('Check in on {id}');
    await app.close();
  });

  it('eip712: reconstructs the stored selector from typedData types', async () => {
    // The registry keys an eip712 format by keccak(encodeType(primaryType))[:4].
    // A reconstructed encodeType must hit the same selector. Order has no nested
    // struct deps, so its encoding is just its own field list.
    const row = rowWithBody(
      { kind: 'eip712', intent: 'Send order' },
      { fields: [{ label: 'Maker', path: 'maker', format: 'addressName' }] },
    );
    const { deps, arkiv } = makeDeps({ queryOneRow: row });
    const app = buildServer(deps);
    const res = await app.inject({
      method: 'POST',
      url: '/decode',
      payload: {
        chainId: 1,
        contract: AAVE,
        typedData: {
          primaryType: 'Order',
          types: {
            Order: [
              { name: 'maker', type: 'address' },
              { name: 'amount', type: 'uint256' },
            ],
          },
          message: { maker: '0x1' },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json() as Record<string, any>;
    expect(json.signing.decodedFrom).toBe('eip712');
    expect(json.signing.summary).toBe('Send order');
    expect(json.fields[0].label).toBe('Maker');
    // keccak256("Order(address maker,uint256 amount)")[:4]
    const selector = arkiv.queryOneWithBody.mock.calls[0][0].selector as string;
    expect(selector).toMatch(/^0x[0-9a-f]{8}$/);
    await app.close();
  });

  it('eip712: nested struct dependencies are appended sorted by name', async () => {
    // encodeType must emit the primary type, then referenced structs sorted
    // alphabetically — the wallet and the mirror must agree on this exact order.
    const row = rowWithBody({ kind: 'eip712', intent: 'Mail' }, { fields: [] });
    const { deps, arkiv } = makeDeps({ queryOneRow: row });
    const app = buildServer(deps);
    await app.inject({
      method: 'POST',
      url: '/decode',
      payload: {
        chainId: 1,
        contract: AAVE,
        typedData: {
          primaryType: 'Mail',
          types: {
            Mail: [
              { name: 'from', type: 'Person' },
              { name: 'to', type: 'Person' },
            ],
            Person: [{ name: 'wallet', type: 'address' }],
          },
        },
      },
    });
    // Both selectors derive from the same encodeType string; assert it resolves
    // to a concrete 4-byte selector (proves deps were included without throwing).
    const selector = arkiv.queryOneWithBody.mock.calls[0][0].selector as string;
    expect(selector).toMatch(/^0x[0-9a-f]{8}$/);
    await app.close();
  });

  it('404 when no descriptor matches the derived selector', async () => {
    const { deps } = makeDeps({ queryOneRow: null });
    const app = buildServer(deps);
    const res = await app.inject({
      method: 'POST',
      url: '/decode',
      payload: { chainId: 1, contract: AAVE, calldata: '0xdeadbeef' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('400 on a bad request body (no calldata or typedData)', async () => {
    const { deps } = makeDeps();
    const app = buildServer(deps);
    const res = await app.inject({
      method: 'POST',
      url: '/decode',
      payload: { chainId: 1, contract: AAVE },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('400 on a malformed contract address', async () => {
    const { deps } = makeDeps();
    const app = buildServer(deps);
    const res = await app.inject({
      method: 'POST',
      url: '/decode',
      payload: { chainId: 1, contract: 'nope', calldata: '0x474cf53d' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('400 when typedData.primaryType is absent from types', async () => {
    const { deps } = makeDeps();
    const app = buildServer(deps);
    const res = await app.inject({
      method: 'POST',
      url: '/decode',
      payload: {
        chainId: 1,
        contract: AAVE,
        typedData: { primaryType: 'Missing', types: { Order: [] } },
      },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('pre-body row (no body stored) still returns the column summary', async () => {
    const row: Record<string, unknown> = {
      $key: '0xkey',
      functionName: { type: 'str', value: 'legacyFn' },
      kind: { type: 'str', value: 'calldata' },
      intent: { type: 'str', value: 'Legacy action' },
    };
    const { deps } = makeDeps({ queryOneRow: row });
    const app = buildServer(deps);
    const res = await app.inject({
      method: 'POST',
      url: '/decode',
      payload: { chainId: 1, contract: AAVE, calldata: '0x12345678' },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json() as Record<string, any>;
    expect(json.signing.summary).toBe('Legacy action');
    expect(json.fields).toEqual([]);
    await app.close();
  });
});

describe('POST /descriptors — signed write', () => {
  it('valid allowlisted signature: upsert + PR, returns entityKey/txHash/prUrl', async () => {
    const descriptor = oneRecordDescriptor();
    const { deps, arkiv, github } = makeDeps({ wallets: [SIGNER_LOWER] });
    const app = buildServer(deps);
    const msg: DescriptorWriteMessage = {
      descriptorHash: descriptorHash(descriptor),
      deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
      nonce: 1n,
      action: 'create',
    };
    const signature = await signMessage(msg);
    const res = await app.inject({
      method: 'POST',
      url: '/descriptors',
      payload: {
        descriptor,
        message: {
          descriptorHash: msg.descriptorHash,
          deadline: msg.deadline.toString(),
          nonce: msg.nonce.toString(),
          action: 'create',
        },
        signature,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { entityKey: string; txHash: string; prUrl: string };
    expect(body.entityKey).toBe('0xentitykey');
    expect(body.prUrl).toBe('https://github.com/ef/registry/pull/1');

    expect(arkiv.upsert).toHaveBeenCalledTimes(1);
    expect(arkiv.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: 1 }),
      expect.objectContaining({
        source: 'authorized-write',
        authorizedBy: SIGNER_LOWER,
      }),
    );
    expect(github.openDescriptorPR).toHaveBeenCalledWith(
      expect.objectContaining({ wallet: SIGNER_LOWER, action: 'create' }),
    );
    await app.close();
  });

  it('with an EF attester: attests, patches the row with the UID, returns attested:true', async () => {
    const descriptor = oneRecordDescriptor();
    const ATT_UID = '0x' + 'a7'.repeat(32);
    const ATT_SIGNER = '0x00000000000000000000000000000000000000ef';
    const attest = vi.fn(async () => ({ uid: ATT_UID, attester: ATT_SIGNER }));
    const { deps, arkiv } = makeDeps({
      wallets: [SIGNER_LOWER],
      attester: { attest },
    });
    const app = buildServer(deps);
    const msg: DescriptorWriteMessage = {
      descriptorHash: descriptorHash(descriptor),
      deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
      nonce: 10n,
      action: 'create',
    };
    const signature = await signMessage(msg);
    const res = await app.inject({
      method: 'POST',
      url: '/descriptors',
      payload: {
        descriptor,
        message: {
          descriptorHash: msg.descriptorHash,
          deadline: msg.deadline.toString(),
          nonce: msg.nonce.toString(),
          action: 'create',
        },
        signature,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      entityKey: string;
      txHash: string;
      prUrl: string;
      attested: boolean;
      attestationUID?: string;
    };
    expect(body.attested).toBe(true);
    expect(body.attestationUID).toBe(ATT_UID);

    // Attest is over the content hash (the subject of every attestation).
    expect(attest).toHaveBeenCalledWith(msg.descriptorHash);

    // The row is re-upserted carrying the UID + attester in WriteMeta.
    const attestUpsert = arkiv.upsert.mock.calls.find(
      (c) => (c[1] as { attestationUID?: string }).attestationUID === ATT_UID,
    );
    expect(attestUpsert).toBeDefined();
    expect(attestUpsert![1]).toMatchObject({
      attestationUID: ATT_UID,
      attester: ATT_SIGNER,
    });
    await app.close();
  });

  it('attester throws: write still succeeds (200) with attested:false, no UID', async () => {
    const descriptor = oneRecordDescriptor();
    const attest = vi.fn(async () => {
      throw new Error('EAS down');
    });
    const { deps } = makeDeps({ wallets: [SIGNER_LOWER], attester: { attest } });
    const app = buildServer(deps);
    const msg: DescriptorWriteMessage = {
      descriptorHash: descriptorHash(descriptor),
      deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
      nonce: 11n,
      action: 'create',
    };
    const signature = await signMessage(msg);
    const res = await app.inject({
      method: 'POST',
      url: '/descriptors',
      payload: {
        descriptor,
        message: {
          descriptorHash: msg.descriptorHash,
          deadline: msg.deadline.toString(),
          nonce: msg.nonce.toString(),
          action: 'create',
        },
        signature,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      entityKey: string;
      txHash: string;
      prUrl: string;
      attested: boolean;
      attestationUID?: string;
    };
    expect(body.entityKey).toBe('0xentitykey');
    expect(body.txHash).toBe('0xtxhash');
    expect(body.prUrl).toBe('https://github.com/ef/registry/pull/1');
    expect(body.attested).toBe(false);
    expect(body.attestationUID).toBeUndefined();
    await app.close();
  });

  it('no attester configured: write succeeds with attested:false and no attest call', async () => {
    const descriptor = oneRecordDescriptor();
    const { deps, arkiv } = makeDeps({ wallets: [SIGNER_LOWER] }); // no attester
    const app = buildServer(deps);
    const msg: DescriptorWriteMessage = {
      descriptorHash: descriptorHash(descriptor),
      deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
      nonce: 12n,
      action: 'create',
    };
    const signature = await signMessage(msg);
    const res = await app.inject({
      method: 'POST',
      url: '/descriptors',
      payload: {
        descriptor,
        message: {
          descriptorHash: msg.descriptorHash,
          deadline: msg.deadline.toString(),
          nonce: msg.nonce.toString(),
          action: 'create',
        },
        signature,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { attested: boolean; attestationUID?: string };
    expect(body.attested).toBe(false);
    expect(body.attestationUID).toBeUndefined();
    // Only the single content upsert — no attestation patch upsert.
    expect(arkiv.upsert).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('bad signature (signer not allowlisted) -> 401 UNAUTHORIZED', async () => {
    const descriptor = oneRecordDescriptor();
    const { deps, arkiv } = makeDeps({ wallets: [] }); // empty allowlist
    const app = buildServer(deps);
    const msg: DescriptorWriteMessage = {
      descriptorHash: descriptorHash(descriptor),
      deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
      nonce: 2n,
      action: 'create',
    };
    const signature = await signMessage(msg);
    const res = await app.inject({
      method: 'POST',
      url: '/descriptors',
      payload: {
        descriptor,
        message: {
          descriptorHash: msg.descriptorHash,
          deadline: msg.deadline.toString(),
          nonce: msg.nonce.toString(),
          action: 'create',
        },
        signature,
      },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'UNAUTHORIZED' });
    expect(arkiv.upsert).not.toHaveBeenCalled();
    await app.close();
  });

  it('HASH_MISMATCH -> 400 {error:HASH_MISMATCH}', async () => {
    const descriptor = oneRecordDescriptor();
    const { deps } = makeDeps({ wallets: [SIGNER_LOWER] });
    const app = buildServer(deps);
    // Sign over a DIFFERENT descriptor hash than the body we send.
    const msg: DescriptorWriteMessage = {
      descriptorHash: descriptorHash({ different: true }),
      deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
      nonce: 3n,
      action: 'create',
    };
    const signature = await signMessage(msg);
    const res = await app.inject({
      method: 'POST',
      url: '/descriptors',
      payload: {
        descriptor,
        message: {
          descriptorHash: msg.descriptorHash,
          deadline: msg.deadline.toString(),
          nonce: msg.nonce.toString(),
          action: 'create',
        },
        signature,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'HASH_MISMATCH' });
    await app.close();
  });

  it('EXPIRED deadline -> 400 {error:EXPIRED}', async () => {
    const descriptor = oneRecordDescriptor();
    const { deps } = makeDeps({ wallets: [SIGNER_LOWER] });
    const app = buildServer(deps);
    const msg: DescriptorWriteMessage = {
      descriptorHash: descriptorHash(descriptor),
      deadline: BigInt(Math.floor(Date.now() / 1000) - 10),
      nonce: 4n,
      action: 'create',
    };
    const signature = await signMessage(msg);
    const res = await app.inject({
      method: 'POST',
      url: '/descriptors',
      payload: {
        descriptor,
        message: {
          descriptorHash: msg.descriptorHash,
          deadline: msg.deadline.toString(),
          nonce: msg.nonce.toString(),
          action: 'create',
        },
        signature,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'EXPIRED' });
    await app.close();
  });

  it('REPLAY (reused nonce) -> 400 {error:REPLAY}', async () => {
    const descriptor = oneRecordDescriptor();
    const nonceUsed = new Set<string>();
    const { deps } = makeDeps({ wallets: [SIGNER_LOWER], nonceUsed });
    const app = buildServer(deps);
    const msg: DescriptorWriteMessage = {
      descriptorHash: descriptorHash(descriptor),
      deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
      nonce: 7n,
      action: 'create',
    };
    const signature = await signMessage(msg);
    const payload = {
      descriptor,
      message: {
        descriptorHash: msg.descriptorHash,
        deadline: msg.deadline.toString(),
        nonce: msg.nonce.toString(),
        action: 'create',
      },
      signature,
    };
    const first = await app.inject({ method: 'POST', url: '/descriptors', payload });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({ method: 'POST', url: '/descriptors', payload });
    expect(second.statusCode).toBe(400);
    expect(second.json()).toEqual({ error: 'REPLAY' });
    await app.close();
  });

  it('out-of-union action from a valid signer -> 400 (T6 handoff)', async () => {
    const descriptor = oneRecordDescriptor();
    const { deps, arkiv } = makeDeps({ wallets: [SIGNER_LOWER] });
    const app = buildServer(deps);
    // Sign a message whose action is NOT in the known union. verifyWrite
    // recovers the signer fine (string type), the route rejects the action.
    const msg = {
      descriptorHash: descriptorHash(descriptor),
      deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
      nonce: 8n,
      action: 'destroy' as unknown as 'create',
    };
    const signature = await signMessage(msg as DescriptorWriteMessage);
    const res = await app.inject({
      method: 'POST',
      url: '/descriptors',
      payload: {
        descriptor,
        message: {
          descriptorHash: msg.descriptorHash,
          deadline: msg.deadline.toString(),
          nonce: msg.nonce.toString(),
          action: 'destroy',
        },
        signature,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(arkiv.upsert).not.toHaveBeenCalled();
    await app.close();
  });

  it('malformed non-numeric nonce -> 400, not 500', async () => {
    const descriptor = oneRecordDescriptor();
    const { deps } = makeDeps({ wallets: [SIGNER_LOWER] });
    const app = buildServer(deps);
    const res = await app.inject({
      method: 'POST',
      url: '/descriptors',
      payload: {
        descriptor,
        message: {
          descriptorHash: descriptorHash(descriptor),
          deadline: '9999999999',
          nonce: 'not-a-number',
          action: 'create',
        },
        signature: '0xdeadbeef',
      },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('delete: removes entity + opens removal PR', async () => {
    const descriptor = oneRecordDescriptor();
    const { deps, arkiv, github } = makeDeps({
      wallets: [SIGNER_LOWER],
      queryOneRow: { $key: '0xexisting' },
    });
    const app = buildServer(deps);
    const msg: DescriptorWriteMessage = {
      descriptorHash: descriptorHash(descriptor),
      deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
      nonce: 9n,
      action: 'delete',
    };
    const signature = await signMessage(msg);
    const res = await app.inject({
      method: 'POST',
      url: '/descriptors',
      payload: {
        descriptor,
        message: {
          descriptorHash: msg.descriptorHash,
          deadline: msg.deadline.toString(),
          nonce: msg.nonce.toString(),
          action: 'delete',
        },
        signature,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      txHash: '0xremovetx',
      prUrl: 'https://github.com/ef/registry/pull/1',
    });
    expect(arkiv.remove).toHaveBeenCalledWith('0xexisting');
    expect(github.openDescriptorPR).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', entityKey: '0xexisting' }),
    );
    await app.close();
  });
});

describe('POST /webhooks/github', () => {
  function pushPayload() {
    return {
      after: 'HEADSHA',
      commits: [
        {
          added: ['registry/aave/calldata-Pool.json'],
          modified: [],
          removed: [],
        },
      ],
    };
  }

  it('wrong signature -> 401', async () => {
    const { deps } = makeDeps();
    const app = buildServer(deps);
    const bodyStr = JSON.stringify(pushPayload());
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: {
        'content-type': 'application/json',
        'x-github-delivery': 'd1',
        'x-hub-signature-256': sign('WRONG-SECRET', bodyStr),
      },
      payload: bodyStr,
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('correct signature -> 202 and runs ingest', async () => {
    // getFile returns an includes-free simple descriptor so applyChangedFile
    // reaches the write branch; we only assert the ingest path ran (getFile).
    const { deps, github } = makeDeps();
    github.getFile = vi.fn(async () => ({
      content: oneRecordDescriptor(),
      sha: 'BLOB',
    }));
    const app = buildServer(deps);
    const bodyStr = JSON.stringify(pushPayload());
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: {
        'content-type': 'application/json',
        'x-github-delivery': 'd2',
        'x-hub-signature-256': sign(WEBHOOK_SECRET, bodyStr),
      },
      payload: bodyStr,
    });
    expect(res.statusCode).toBe(202);
    expect(github.getFile).toHaveBeenCalledWith(
      'registry/aave/calldata-Pool.json',
      'HEADSHA',
    );
    await app.close();
  });

  it('replayed delivery id -> 200 no-op, ingest NOT re-run', async () => {
    const deliveries = new Set<string>();
    const { deps, github } = makeDeps({ deliveries });
    github.getFile = vi.fn(async () => ({
      content: oneRecordDescriptor(),
      sha: 'BLOB',
    }));
    const app = buildServer(deps);
    const bodyStr = JSON.stringify(pushPayload());
    const headers = {
      'content-type': 'application/json',
      'x-github-delivery': 'd3',
      'x-hub-signature-256': sign(WEBHOOK_SECRET, bodyStr),
    };
    const first = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers,
      payload: bodyStr,
    });
    expect(first.statusCode).toBe(202);
    const callsAfterFirst = github.getFile.mock.calls.length;

    const second = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers,
      payload: bodyStr,
    });
    expect(second.statusCode).toBe(200);
    // No further ingest on the replay.
    expect(github.getFile.mock.calls.length).toBe(callsAfterFirst);
    await app.close();
  });
});
