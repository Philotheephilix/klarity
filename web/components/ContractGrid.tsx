import { RichCard } from './RichCard';
import { shortAddress } from '../lib/cardmeta';
import { groupByContract } from '../lib/group';
import type { DescriptorRow } from '../lib/types';

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
        <div className="empty-card">
          <div className="card-title">No mirrored contracts</div>
          <p className="card-note">
            No clear-signing descriptors are mirrored for this company yet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="card-grid">
      {groups.map((group) => {
        const first = group.selectors[0];
        return (
          <RichCard
            key={`${group.chainId}:${group.contract}`}
            thumbKey={`${group.chainId}:${group.contract}`}
            thumbName={group.contractName || group.contract}
            status={group.kinds.includes('eip712') ? 'eip712' : 'clear-signed'}
            statusTone="ok"
            bookmarkId={`contract:${group.chainId}:${group.contract}`}
            title={group.contractName || 'Unnamed contract'}
            subtitle={shortAddress(group.contract)}
            meta={[
              { label: 'chain', value: group.chainId },
              { label: 'calls', value: group.selectors.length },
              { label: 'kinds', value: group.kinds.join(', ') },
              { label: 'entity', value: first?.entityName ?? '—' },
            ]}
            footerName={first?.entityName ?? group.contractName}
            footerSource={first?.sourcePath ?? ''}
            onOpen={() => onSelect(group.chainId, group.contract)}
          />
        );
      })}
    </div>
  );
}
