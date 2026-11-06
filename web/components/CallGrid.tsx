import { Card } from './Card';
import { TagChip } from './Chip';
import { MonoLabel } from './CodeBlock';
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
        <Card>
          <div className="card-pad">
            <div className="card-title">No calls</div>
            <p className="card-note">This contract has no mirrored calls.</p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="card-grid">
      {rows.map((row) => (
        <Card key={row.selector} onClick={() => onSelect(row)}>
          <div className="card-pad">
            <div className="card-title">{row.functionName || row.selector}</div>
            <MonoLabel>{row.selector}</MonoLabel>
            <p className="card-note">{row.intent}</p>
            <div className="ctx-chips">
              <TagChip>{row.kind}</TagChip>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
