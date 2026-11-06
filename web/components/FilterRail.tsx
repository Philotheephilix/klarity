import { Chip } from './Chip';

export type KindFilter = 'all' | 'calldata' | 'eip712';

export function FilterRail({
  chainIds,
  activeKind,
  activeChainId,
  onKind,
  onChainId,
}: {
  chainIds: number[];
  activeKind: KindFilter;
  activeChainId: number | null;
  onKind: (kind: KindFilter) => void;
  onChainId: (chainId: number) => void;
}) {
  const kinds: KindFilter[] = ['all', 'calldata', 'eip712'];
  return (
    <div className="filter-rail">
      <div className="bench-chips">
        {kinds.map((k) => (
          <Chip
            key={k}
            label={k === 'all' ? 'All' : k}
            active={activeKind === k}
            onClick={() => onKind(k)}
          />
        ))}
      </div>
      <div className="bench-chips">
        {chainIds.map((id) => (
          <Chip
            key={id}
            label={String(id)}
            active={activeChainId === id}
            onClick={() => onChainId(id)}
          />
        ))}
      </div>
    </div>
  );
}
