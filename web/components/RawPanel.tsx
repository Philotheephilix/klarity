import { Card } from './Card';
import { CodeBlock, MonoLabel } from './CodeBlock';
import { TagChip } from './Chip';
import type { RawPanelVM } from '../lib/viewmodel';

export function RawPanel({ vm }: { vm: RawPanelVM }) {
  const body =
    vm.mode === 'calldata'
      ? vm.hex ?? ''
      : JSON.stringify(vm.typedData, null, 2);

  return (
    <Card>
      <div className="panel panel-raw">
        <MonoLabel>Sample calldata &mdash; blind sign</MonoLabel>
        <p className="panel-sub">
          This is a sample payload, not a real transaction. A wallet without
          clear-signing shows the user only these raw bytes.
        </p>
        <div className="ctx-chips">
          <TagChip>chain {vm.chainId}</TagChip>
          <TagChip>{vm.selector}</TagChip>
          <TagChip>{vm.mode}</TagChip>
        </div>
        {body ? (
          <CodeBlock>{body}</CodeBlock>
        ) : (
          <p className="panel-sub">No sample payload available for this call.</p>
        )}
      </div>
    </Card>
  );
}
