import type { DescriptorRow } from './types';

export interface ContractGroup {
  chainId: number;
  contract: string;
  contractName: string;
  kinds: string[];
  selectors: DescriptorRow[];
}

export function groupByContract(rows: DescriptorRow[]): ContractGroup[] {
  const map = new Map<string, ContractGroup>();
  for (const row of rows) {
    const key = `${row.chainId}:${row.contract}`;
    let group = map.get(key);
    if (!group) {
      group = {
        chainId: row.chainId,
        contract: row.contract,
        contractName: row.contractName,
        kinds: [],
        selectors: [],
      };
      map.set(key, group);
    }
    group.selectors.push(row);
    if (!group.kinds.includes(row.kind)) {
      group.kinds.push(row.kind);
    }
  }
  return [...map.values()];
}
