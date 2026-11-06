import { describe, expect, it } from 'vitest';
import {
  buildDashboardVM,
  formatCount,
  statusForRow,
} from '../lib/dashboard';
import type { DescriptorRow } from '../lib/types';

function row(partial: Partial<DescriptorRow>): DescriptorRow {
  return {
    chainId: 1,
    contract: '0xaaaa000000000000000000000000000000000001',
    selector: '0x11111111',
    functionName: 'deposit',
    kind: 'calldata',
    intent: 'Deposit',
    entityName: '1inch',
    contractName: 'Router',
    owner: '1inch',
    sourcePath: 'registry/1inch/router.json',
    schemaVersion: '1',
    ...partial,
  };
}

describe('statusForRow', () => {
  it('maps eip712 -> verified and calldata -> pending', () => {
    expect(statusForRow(row({ kind: 'eip712' }))).toBe('verified');
    expect(statusForRow(row({ kind: 'calldata' }))).toBe('pending');
  });
});

describe('formatCount', () => {
  it('suffixes capped counts with a plus', () => {
    expect(formatCount(256, true)).toBe('256+');
    expect(formatCount(56, false)).toBe('56');
  });
});

describe('buildDashboardVM', () => {
  it('derives totals, per-entity, per-chain, contracts, status split and gauge pct', () => {
    // entity 0 (1inch): 3 rows, 2 chains, 2 contracts, 1 eip712 / 2 calldata
    const oneInch = [
      row({ chainId: 1, contract: '0xa1', kind: 'eip712' }),
      row({ chainId: 1, contract: '0xa1', selector: '0x22', kind: 'calldata' }),
      row({ chainId: 10, contract: '0xa2', kind: 'calldata' }),
    ];
    // entity 1 (aave): 1 row on a new chain/contract, eip712
    const aave = [
      row({ entityName: 'aave', chainId: 137, contract: '0xb1', kind: 'eip712' }),
    ];
    // entity 2 (celo): empty
    const celo: DescriptorRow[] = [];

    const vm = buildDashboardVM([oneInch, aave, celo]);

    expect(vm.totalDescriptors).toBe(4);
    expect(vm.entitiesWithData).toBe(2);
    expect(vm.distinctContracts).toBe(3); // 1:0xa1, 10:0xa2, 137:0xb1
    expect(vm.distinctChains).toBe(3); // 1, 10, 137

    const byName = Object.fromEntries(vm.perEntity.map((e) => [e.entityName, e]));
    expect(byName['1inch'].count).toBe(3);
    expect(byName['aave'].count).toBe(1);
    expect(byName['celo'].count).toBe(0);

    // per-chain sums to the total
    const chainSum = vm.perChain.reduce((n, c) => n + c.count, 0);
    expect(chainSum).toBe(4);

    // status split: 2 eip712 (verified), 2 calldata (pending)
    expect(vm.statusSplit.verified).toBe(2);
    expect(vm.statusSplit.pending).toBe(2);
    expect(vm.verifiedPct).toBe(50);
  });

  it('flags capped entities (>=100 rows) and surfaces totalCapped', () => {
    const big = Array.from({ length: 100 }, (_, i) =>
      row({ selector: `0x${i.toString(16).padStart(8, '0')}` }),
    );
    const vm = buildDashboardVM([big, [], []]);
    expect(vm.perEntity[0].capped).toBe(true);
    expect(vm.totalCapped).toBe(true);
    expect(formatCount(vm.totalDescriptors, vm.totalCapped)).toBe('100+');
  });

  it('is empty-safe', () => {
    const vm = buildDashboardVM([[], [], []]);
    expect(vm.totalDescriptors).toBe(0);
    expect(vm.verifiedPct).toBe(0);
    expect(vm.entitiesWithData).toBe(0);
  });
});
