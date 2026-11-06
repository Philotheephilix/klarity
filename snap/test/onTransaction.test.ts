import { describe, it, expect } from 'vitest';
import type { KlarityClient, DecodeResponse } from '@klarity/sdk';
import { buildInsight, onTransaction } from '../src/index.js';

/**
 * Flatten a rendered Snaps JSX element into a single string of all the text it
 * carries. Mirrors the helper used in render.test.tsx: the Snaps JSX runtime
 * returns plain `{ type, props, key }` objects, so a JSON serialization captures
 * every string leaf in the tree.
 */
function renderToString(element: unknown): string {
  return JSON.stringify(element);
}

const decodeResponse: DecodeResponse = {
  signing: {
    chainId: 11155111,
    contract: '0xabcdef0000000000000000000000000000000001',
    selector: '0xa9059cbb',
    kind: 'calldata',
    decodedFrom: 'descriptor',
    interpolatedIntent: 'Send 10 USDC to alice.eth',
    summary: 'transfer(address,uint256)',
  },
  fields: [{ label: 'Recipient', path: 'to', hidden: false }],
  hiddenFields: [],
  note: 'Klarity note: verify before signing.',
  raw: { calldata: '0xa9059cbb' },
};

/** Build a transaction-insight args object of the OnTransaction shape. */
function makeArgs(overrides: { to?: string; data?: string } = {}) {
  return {
    transaction: {
      from: '0x0000000000000000000000000000000000000000',
      to: '0xabcdef0000000000000000000000000000000001',
      nonce: '0x0',
      value: '0x0',
      data: '0xa9059cbb0000000000000000000000000000000000000000000000000000000000000001',
      gas: '0x0',
      gasPrice: '0x0',
      estimateSuggested: '0x0',
      estimateUsed: '0x0',
      ...overrides,
    },
    chainId: 'eip155:11155111' as const,
    transactionOrigin: 'https://example.com',
  };
}

/** A stub KlarityClient whose decode/getDescriptor are fully controllable. */
function fakeClient(overrides: Partial<KlarityClient>): KlarityClient {
  return {
    decode: async () => decodeResponse,
    getDescriptor: async () => ({ verified: null }),
    ...overrides,
  } as unknown as KlarityClient;
}

describe('buildInsight', () => {
  it('returns {content} whose serialized form includes the decoded intent', async () => {
    const client = fakeClient({});
    const result = await buildInsight(makeArgs(), {
      decodeDeps: { client },
      verifiedDeps: { client },
    });
    expect(result).toHaveProperty('content');
    expect(renderToString(result.content)).toContain(
      'Send 10 USDC to alice.eth',
    );
  });

  it('returns a {content} no-data panel (does not throw) when decode returns null', async () => {
    const client = fakeClient({
      decode: async () => {
        throw new Error('404 Not Found');
      },
    });
    const result = await buildInsight(makeArgs(), {
      decodeDeps: { client },
      verifiedDeps: { client },
    });
    expect(result).toHaveProperty('content');
    expect(renderToString(result.content)).toContain(
      'No Klarity clear-signing for this transaction.',
    );
  });

  it('does not throw and yields the no-data panel on a malformed chain id', async () => {
    const client = fakeClient({});
    const args = { ...makeArgs(), chainId: 'solana:bad' as unknown as `eip155:${string}` };
    const result = await buildInsight(args as never, {
      decodeDeps: { client },
      verifiedDeps: { client },
    });
    expect(result).toHaveProperty('content');
    expect(renderToString(result.content)).toContain(
      'No Klarity clear-signing for this transaction.',
    );
  });

  it('skips the verified lookup when there is no selector (plain transfer)', async () => {
    let getDescriptorCalled = false;
    const client = fakeClient({
      getDescriptor: async () => {
        getDescriptorCalled = true;
        return { verified: null } as never;
      },
    });
    await buildInsight(makeArgs({ data: '0x' }), {
      decodeDeps: { client },
      verifiedDeps: { client },
    });
    expect(getDescriptorCalled).toBe(false);
  });
});

describe('onTransaction', () => {
  it('returns a {content} object without throwing (real deps, offline)', async () => {
    const result = await onTransaction(makeArgs());
    expect(result).toHaveProperty('content');
  });
});
