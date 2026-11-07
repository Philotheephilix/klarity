import { describe, expect, it } from 'vitest';
import { groupByContract } from '../lib/group';
import type { DescriptorRow } from '../lib/types';

function row(partial: Partial<DescriptorRow>): DescriptorRow {
  return {
    chainId: 1,
    contract: '0xaaa',
    selector: '0x11111111',
    kind: 'calldata',
    intent: 'do a thing',
    entityName: 'aave',
    contractName: 'Pool',
    owner: 'aave',
    sourcePath: 'registry/aave/pool.json',
    schemaVersion: '1',
    ...partial,
  };
}

describe('groupByContract', () => {
  it('merges rows sharing (chainId, contract) and dedupes kinds', () => {
    const groups = groupByContract([
      row({ selector: '0x11111111', kind: 'calldata' }),
      row({ selector: '0x22222222', kind: 'eip712' }),
      row({ selector: '0x33333333', kind: 'calldata' }),
      row({ chainId: 137, contract: '0xbbb', selector: '0x44444444', kind: 'calldata' }),
    ]);

    expect(groups).toHaveLength(2);
    const pool = groups.find((g) => g.contract === '0xaaa' && g.chainId === 1)!;
    expect(pool.selectors).toHaveLength(3);
    expect(pool.kinds.sort()).toEqual(['calldata', 'eip712']);
    expect(pool.contractName).toBe('Pool');

    const other = groups.find((g) => g.contract === '0xbbb')!;
    expect(other.selectors).toHaveLength(1);
    expect(other.kinds).toEqual(['calldata']);
  });

  it('returns an empty array for no rows', () => {
    expect(groupByContract([])).toEqual([]);
  });
});
