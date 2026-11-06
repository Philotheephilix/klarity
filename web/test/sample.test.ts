import { describe, expect, it } from 'vitest';
import { sampleCalldata, sampleDecodeRequest } from '../lib/sample';
import type { DescriptorRow } from '../lib/types';

const calldataRow: DescriptorRow = {
  chainId: 1,
  contract: '0xd0a1e359811322d97991e03f863a0c30c2cf029c',
  selector: '0x474cf53d',
  functionName: 'deposit',
  kind: 'calldata',
  intent: 'Deposit',
  entityName: 'aave',
  contractName: 'WETH Gateway',
  owner: 'aave',
  sourcePath: 'registry/aave/weth.json',
  schemaVersion: '1',
};

const eip712Row: DescriptorRow = {
  chainId: 1,
  contract: '0x1111111111111111111111111111111111111111',
  selector: '0x7b63e942',
  functionName: 'fillOrder',
  kind: 'eip712',
  eip712PrimaryType: 'Order',
  intent: 'Fill an order',
  entityName: '1inch',
  contractName: 'Aggregation Router',
  owner: '1inch',
  sourcePath: 'registry/1inch/router.json',
  schemaVersion: '1',
};

describe('sampleCalldata', () => {
  it('returns selector + 64-hex words and is deterministic', () => {
    const a = sampleCalldata('0x474cf53d');
    const b = sampleCalldata('0x474cf53d');
    expect(a).toMatch(/^0x474cf53d([0-9a-f]{64})+$/);
    expect(a).toBe(b);
  });

  it('returns exactly the selector when argCount is 0', () => {
    expect(sampleCalldata('0x474cf53d', 0)).toBe('0x474cf53d');
  });

  it('produces one 64-hex word per argCount', () => {
    const words = sampleCalldata('0x474cf53d', 3).slice('0x474cf53d'.length);
    expect(words.length).toBe(64 * 3);
  });
});

describe('sampleDecodeRequest', () => {
  it('builds a calldata body for a calldata descriptor', () => {
    const body = sampleDecodeRequest(calldataRow);
    expect(body.chainId).toBe(1);
    expect(body.contract).toBe(calldataRow.contract);
    expect(body.calldata?.startsWith('0x474cf53d')).toBe(true);
    expect(body.typedData).toBeUndefined();
  });

  it('builds a typedData body for an eip712 descriptor', () => {
    const body = sampleDecodeRequest(eip712Row);
    expect(body.calldata).toBeUndefined();
    expect(body.selector).toBe('0x7b63e942');
    expect((body.typedData as { primaryType: string }).primaryType).toBe('Order');
  });
});
