import { Chip } from './Chip';

export type KindFilter = 'all' | 'calldata' | 'eip712';

/**
 * Left filter rail for the list pages. Header + reset, a segmented kind group
 * (maps to DescriptorRow.kind), a chainId select built from the data's distinct
 * chain ids, and a min/max numeric pair for per-contract call counts. The kind
 * chips and chainId chips remain plain .bench-chip buttons so the active state
 * reads with the rest of the explorer and the existing FilterRail tests hold.
 */
export function FilterRail({
  chainIds,
  activeKind,
  activeChainId,
  onKind,
  onChainId,
  minCalls,
  maxCalls,
  onMinCalls,
  onMaxCalls,
  onReset,
}: {
  chainIds: number[];
  activeKind: KindFilter;
  activeChainId: number | null;
  onKind: (kind: KindFilter) => void;
  onChainId: (chainId: number | null) => void;
  minCalls?: string;
  maxCalls?: string;
  onMinCalls?: (value: string) => void;
  onMaxCalls?: (value: string) => void;
  onReset?: () => void;
}) {
  const kinds: KindFilter[] = ['all', 'calldata', 'eip712'];
  return (
    <aside className="filter-rail">
      <div className="filter-head">
        <span className="filter-title">Filter</span>
        {onReset ? (
          <button type="button" className="filter-reset" onClick={onReset}>
            Reset filter
          </button>
        ) : null}
      </div>

      <div className="filter-group">
        <span className="filter-legend mono">kind</span>
        <div className="bench-chips" role="radiogroup" aria-label="kind">
          {kinds.map((k) => (
            <Chip
              key={k}
              label={k === 'all' ? 'All' : k}
              active={activeKind === k}
              onClick={() => onKind(k)}
            />
          ))}
        </div>
      </div>

      <div className="filter-group">
        <span className="filter-legend mono">chain</span>
        <select
          className="filter-select"
          aria-label="chainId"
          value={activeChainId === null ? '' : String(activeChainId)}
          onChange={(e) =>
            onChainId(e.target.value === '' ? null : Number(e.target.value))
          }
        >
          <option value="">All chains</option>
          {chainIds.map((id) => (
            <option key={id} value={String(id)}>
              {id}
            </option>
          ))}
        </select>
      </div>

      <div className="filter-group">
        <span className="filter-legend mono">calls</span>
        <div className="filter-range">
          <input
            className="filter-num"
            type="number"
            min={0}
            inputMode="numeric"
            placeholder="min"
            aria-label="min calls"
            value={minCalls ?? ''}
            onChange={(e) => onMinCalls?.(e.target.value)}
          />
          <span className="filter-range-dash" aria-hidden="true">
            &ndash;
          </span>
          <input
            className="filter-num"
            type="number"
            min={0}
            inputMode="numeric"
            placeholder="max"
            aria-label="max calls"
            value={maxCalls ?? ''}
            onChange={(e) => onMaxCalls?.(e.target.value)}
          />
        </div>
      </div>
    </aside>
  );
}
