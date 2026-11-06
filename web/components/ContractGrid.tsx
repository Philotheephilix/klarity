import { Card } from './Card';
import { TagChip } from './Chip';
import { MonoLabel } from './CodeBlock';
import { groupByContract } from '../lib/group';
import type { DescriptorRow } from '../lib/types';

function shortAddress(address: string): string {
  if (address.length <= 14) return address;
  return `${address.slice(0, 10)}...${address.slice(-4)}`;
}

export function ContractGrid({
  rows,
  onSelect,
}: {
  rows: DescriptorRow[];
  onSelect: (chainId: number, contract: string) => void;
}) {
  const groups = groupByContract(rows);

  if (groups.length === 0) {
    return (
      <div className="card-grid">
        <Card>
          <div className="card-pad">
            <div className="card-title">No mirrored contracts</div>
            <p className="card-note">
              No clear-signing descriptors are mirrored for this company yet.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="card-grid">
      {groups.map((group) => (
        <Card
          key={`${group.chainId}:${group.contract}`}
          onClick={() => onSelect(group.chainId, group.contract)}
        >
          <div className="card-pad">
            <div className="card-title">{group.contractName || 'Unnamed contract'}</div>
            <MonoLabel>{shortAddress(group.contract)}</MonoLabel>
            <div className="ctx-chips">
              <TagChip>chain {group.chainId}</TagChip>
              {group.kinds.map((kind) => (
                <TagChip key={kind}>{kind}</TagChip>
              ))}
              <TagChip>{group.selectors.length} calls</TagChip>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
