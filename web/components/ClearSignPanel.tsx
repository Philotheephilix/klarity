import { Card } from './Card';
import { MonoLabel } from './CodeBlock';
import { TagChip } from './Chip';
import type { ClearSignVM } from '../lib/viewmodel';

export function ClearSignPanel({ vm }: { vm: ClearSignVM }) {
  return (
    <Card>
      <div className="panel panel-clear">
        <MonoLabel>Clear sign</MonoLabel>
        <div className="ctx-chips">
          <TagChip>{vm.contractName}</TagChip>
          <TagChip>{vm.functionName}</TagChip>
          <TagChip>{vm.kind}</TagChip>
        </div>

        {vm.hasFields ? (
          <>
            <h2 className="panel-summary">{vm.summary}</h2>
            <ul className="field-list">
              {vm.visibleFields.map((field) => (
                <li key={field.path} className="field-row">
                  <span className="field-label">{field.label}</span>
                  {field.format ? <TagChip>{field.format}</TagChip> : null}
                  <MonoLabel>{field.path}</MonoLabel>
                </li>
              ))}
            </ul>
            {vm.hiddenFields.length > 0 ? (
              <details className="hidden-fields">
                <summary>{vm.hiddenFields.length} hidden field(s)</summary>
                <ul className="field-list">
                  {vm.hiddenFields.map((field) => (
                    <li key={field.path} className="field-row">
                      <span className="field-label">{field.label}</span>
                      <MonoLabel>{field.path}</MonoLabel>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        ) : (
          <p className="panel-empty">Clear-sign labels unavailable for this row</p>
        )}

        <p className="panel-note">{vm.note}</p>
      </div>
    </Card>
  );
}
