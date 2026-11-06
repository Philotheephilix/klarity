import 'dotenv/config';
import { describe, it, expect, beforeAll } from 'vitest';
import { ArkivClient } from '../../src/arkiv/client.js';
import { descriptorHash } from '../../src/hash.js';
import type { Config } from '../../src/config.js';
import type { EntityRecord } from '../../src/normalize/types.js';

const HAS_KEY = !!process.env.ARKIV_PRIVATE_KEY;
const RABDI_RPC = 'https://rpc.rabdi.db-chain.testnet.arkiv.network';

// ArkivClient only consumes `config.arkiv`; build it straight from env so the
// test does not depend on unrelated required config (GITHUB_TOKEN, etc.).
function arkivConfig(privateKey: string): Config {
  return {
    arkiv: {
      privateKey,
      rpcUrl: process.env.ARKIV_RPC_URL ?? RABDI_RPC,
      wsUrl: '',
      chainId: Number(process.env.ARKIV_CHAIN_ID ?? '7794095'),
      accessKey: process.env.ARKIV_ACCESS_KEY ?? '',
    },
  } as unknown as Config;
}

// A throwaway identity unlikely to collide with real registry data: a synthetic
// high chainId plus a random contract address, regenerated per run.
function throwawayRecord(): { rec: EntityRecord; contentHash: string } {
  const rand = Array.from({ length: 40 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join('');
  const contract = `0x${rand}`;
  const descriptor = {
    $schema: 'https://klarity.test/erc7730-v1',
    marker: `klarity-int-${Date.now()}-${rand.slice(0, 8)}`,
  };
  const rec: EntityRecord = {
    chainId: 999_999_999,
    contract,
    selector: '0xdeadbeef',
    functionName: 'klarityIntTest',
    functionSignature: 'klarityIntTest(uint256)',
    kind: 'calldata',
    intent: 'Integration test',
    entityName: 'klarity-int',
    contractName: 'KlarityIntTest',
    owner: 'Klarity',
    sourcePath: 'registry/klarity-int/calldata-KlarityIntTest.json',
    schemaVersion: 'https://klarity.test/erc7730-v1',
    formatBlock: descriptor,
  };
  return { rec, contentHash: descriptorHash(descriptor) };
}

describe('ArkivClient query shape (offline)', () => {
  it('queryMany pins .createdBy(REGISTRY_WALLET) on every read', () => {
    // Build with a dummy key so this runs with or without a funded wallet.
    const key =
      process.env.ARKIV_PRIVATE_KEY ??
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
    const client = new ArkivClient(arkivConfig(key));
    const q = client
      .queryManyBuilder({ chainId: 1, contract: '0xd01607c3c5ecaba394d8be377a08590149325722' })
      .toString();
    // The creator trust filter must be present, naming the service wallet.
    expect(q.toLowerCase()).toContain(client.registryWallet.toLowerCase());
    expect(q).toMatch(/\$creator/);
  });
});

describe.skipIf(!HAS_KEY)('ArkivClient live round-trip (Rabdi)', () => {
  let client: ArkivClient;

  beforeAll(() => {
    client = new ArkivClient(arkivConfig(process.env.ARKIV_PRIVATE_KEY as string));
  });

  it('upsert -> queryOne -> re-upsert (same key, no dup) -> remove -> null', async () => {
    const { rec, contentHash } = throwawayRecord();
    const identity = { chainId: rec.chainId, contract: rec.contract, selector: rec.selector };

    // 1. First upsert creates the entity.
    const first = await client.upsert(rec, { source: 'github-sync', contentHash });
    console.log(
      `[int][live][rabdi] upsert#1 created=${first.created} entityKey=${first.entityKey} txHash=${first.txHash}`,
    );
    expect(first.entityKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(first.txHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(first.created).toBe(true);

    // 2. queryOne returns it with matching payload (identity attributes).
    const got = await client.queryOne(identity);
    expect(got).not.toBeNull();
    expect(Number((got!.chainId as { value: bigint }).value)).toBe(rec.chainId);
    expect((got!.selector as { value: string }).value).toBe(rec.selector);
    expect((got!.$key as string).toLowerCase()).toBe(first.entityKey.toLowerCase());

    // 2b. queryOneWithBody returns the same row plus the non-indexed body columns.
    const withBody = await client.queryOneWithBody(identity);
    expect(withBody).not.toBeNull();
    expect((withBody!.$key as string).toLowerCase()).toBe(first.entityKey.toLowerCase());
    expect(withBody!.body).toBeDefined();
    expect(withBody!.bodyHash).toBeDefined();

    // 3. Second upsert of the SAME identity patches -> same key, no duplicate.
    const newHash = descriptorHash({ ...rec.formatBlock, patched: true });
    const second = await client.upsert(
      { ...rec, intent: 'Integration test v2' },
      { source: 'github-sync', contentHash: newHash },
    );
    console.log(
      `[int][live][rabdi] upsert#2 created=${second.created} entityKey=${second.entityKey} txHash=${second.txHash}`,
    );
    expect(second.created).toBe(false);
    expect(second.entityKey.toLowerCase()).toBe(first.entityKey.toLowerCase());

    const all = await client.queryMany(identity);
    expect(all.length).toBe(1);
    expect((all[0]!.intent as { value: string }).value).toBe('Integration test v2');

    // 4. remove -> queryOne returns null.
    const removed = await client.remove(first.entityKey);
    console.log(`[int][live][rabdi] remove entityKey=${first.entityKey} txHash=${removed.txHash}`);
    expect(removed.txHash).toMatch(/^0x[0-9a-fA-F]{64}$/);

    const after = await client.queryOne(identity);
    expect(after).toBeNull();
  }, 180_000);
});
