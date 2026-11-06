import { RichCard } from './RichCard';
import type { DescriptorRow } from '../lib/types';

export function CallGrid({
  rows,
  onSelect,
}: {
  rows: DescriptorRow[];
  onSelect: (row: DescriptorRow) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="card-grid">
        <div className="empty-card">
          <div className="card-title">No calls</div>
          <p className="card-note">This contract has no mirrored calls.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card-grid">
      {rows.map((row) => (
        <RichCard
          key={row.selector}
          thumbKey={`${row.selector}:${row.contract}`}
          thumbName={row.functionName || row.selector}
          status={row.kind}
          statusTone={row.kind === 'eip712' ? 'pick' : 'ok'}
          bookmarkId={`call:${row.chainId}:${row.contract}:${row.selector}`}
          title={row.functionName || row.selector}
          subtitle={row.selector}
          meta={[
            { label: 'kind', value: row.kind },
            { label: 'chain', value: row.chainId },
            {
              label: row.kind === 'eip712' ? 'primary type' : 'intent',
              value: row.kind === 'eip712' ? row.eip712PrimaryType ?? '—' : row.intent,
            },
            { label: 'schema', value: `v${row.schemaVersion}` },
          ]}
          footerName={row.entityName}
          footerSource={row.sourcePath}
          onOpen={() => onSelect(row)}
        />
      ))}
    </div>
  );
}
