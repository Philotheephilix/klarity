'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useMemo, useState } from 'react';
import { CategoryTabs } from '../../components/CategoryTabs';
import { ContractGrid } from '../../components/ContractGrid';
import { FilterRail, type KindFilter } from '../../components/FilterRail';
import { SearchBar } from '../../components/SearchBar';
import { ErrorCard, LoadingCard, useAsync } from '../../components/States';
import { makeApi } from '../../lib/config';
import { filterContractRows } from '../../lib/filter';
import { groupByContract } from '../../lib/group';
import type { DescriptorRow } from '../../lib/types';

export default function ContractsPage({
  params,
}: {
  params: Promise<{ entity: string }>;
}) {
  const { entity } = use(params);
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [chainId, setChainId] = useState<number | null>(null);
  const [minCalls, setMinCalls] = useState('');
  const [maxCalls, setMaxCalls] = useState('');

  const state = useAsync(
    () => makeApi().listDescriptors({ entityName: entity }),
    [entity],
  );

  const allRows: DescriptorRow[] = state.status === 'ready' ? state.data : [];

  const chainIds = useMemo(
    () => [...new Set(allRows.map((r) => r.chainId))].sort((a, b) => a - b),
    [allRows],
  );

  const q = query.trim().toLowerCase();

  // Row-level filters: search text, kind, chain.
  const rowFiltered = filterContractRows(allRows, q).filter((r) => {
    if (kind !== 'all' && r.kind !== kind) return false;
    if (chainId !== null && r.chainId !== chainId) return false;
    return true;
  });

  // Group-level filter: min/max calls per contract group.
  const min = minCalls === '' ? null : Number(minCalls);
  const max = maxCalls === '' ? null : Number(maxCalls);
  const visibleGroups = groupByContract(rowFiltered).filter((g) => {
    const n = g.selectors.length;
    if (min !== null && Number.isFinite(min) && n < min) return false;
    if (max !== null && Number.isFinite(max) && n > max) return false;
    return true;
  });
  const visibleRows = visibleGroups.flatMap((g) => g.selectors);

  const totalGroups = groupByContract(allRows).length;
  const totalCalls = allRows.length;

  function reset() {
    setQuery('');
    setKind('all');
    setChainId(null);
    setMinCalls('');
    setMaxCalls('');
  }

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/browse">Home</Link>
        <span aria-hidden="true">/</span>
        <Link href="/browse">Companies</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{entity}</span>
      </nav>
      <div className="page-head">
        <h1 className="page-title page-title-xl">{entity}</h1>
        <p className="page-sub">Contracts mirrored for this company.</p>
      </div>

      <CategoryTabs
        tabs={[
          { id: 'contracts', label: 'Contracts', count: totalGroups },
          { id: 'calls', label: 'Calls', count: totalCalls },
        ]}
        activeId="contracts"
      />

      <div className="search-wide">
        <SearchBar
          value={query}
          onChange={setQuery}
          placeholder="Search companies, contracts, selectors"
        />
      </div>

      <div className="explore-layout">
        <FilterRail
          chainIds={chainIds}
          activeKind={kind}
          activeChainId={chainId}
          onKind={setKind}
          onChainId={setChainId}
          minCalls={minCalls}
          maxCalls={maxCalls}
          onMinCalls={setMinCalls}
          onMaxCalls={setMaxCalls}
          onReset={reset}
        />
        <div className="explore-main">
          {state.status === 'loading' ? <LoadingCard label="Loading contracts" /> : null}
          {state.status === 'error' ? <ErrorCard error={state.error} /> : null}
          {state.status === 'ready' ? (
            <ContractGrid
              rows={visibleRows}
              onSelect={(cid, contract) =>
                router.push(`/${entity}/${cid}/${contract}`)
              }
            />
          ) : null}
        </div>
      </div>
    </>
  );
}
