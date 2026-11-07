import { Card } from './Card';
import { MonoLabel } from './CodeBlock';
import { TagChip } from './Chip';
import { shortAddress } from '../lib/cardmeta';
import type { SigningField } from '../lib/types';
import type { ClearSignVM } from '../lib/viewmodel';

/** True when a decoded value looks like a bare 20-byte address. */
function isAddress(field: SigningField): boolean {
  if (field.type === 'address') return true;
  return typeof field.value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(field.value);
}

/** Render the decoded value, truncating address-shaped values for legibility. */
function displayValue(field: SigningField): string {
  const v = field.value ?? '';
  return isAddress(field) ? shortAddress(v) : v;
}

function FieldRow({ field }: { field: SigningField }) {
  const hasValue = typeof field.value === 'string' && field.value.length > 0;
  return (
    <li className="field-row">
      <div className="field-row-head">
        <span className="field-label">{field.label}</span>
        {hasValue ? (
          <span className="field-value" title={field.value}>
            {displayValue(field)}
          </span>
        ) : null}
      </div>
      <div className="field-row-meta">
        <MonoLabel>{field.path}</MonoLabel>
        {field.type ? <span className="field-type">{field.type}</span> : null}
        {field.format ? <TagChip>{field.format}</TagChip> : null}
      </div>
    </li>
  );
}

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
                <FieldRow key={field.path} field={field} />
              ))}
            </ul>
            {vm.hiddenFields.length > 0 ? (
              <details className="hidden-fields">
                <summary>{vm.hiddenFields.length} hidden field(s)</summary>
                <ul className="field-list">
                  {vm.hiddenFields.map((field) => (
                    <FieldRow key={field.path} field={field} />
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
