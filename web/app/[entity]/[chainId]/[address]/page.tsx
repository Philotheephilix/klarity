'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useMemo, useState } from 'react';
import { CallGrid } from '../../../../components/CallGrid';
import { CategoryTabs } from '../../../../components/CategoryTabs';
import { FilterRail, type KindFilter } from '../../../../components/FilterRail';
import { SearchBar } from '../../../../components/SearchBar';
import { ErrorCard, LoadingCard, useAsync } from '../../../../components/States';
import { makeApi } from '../../../../lib/config';
import { filterCallRows } from '../../../../lib/filter';
import type { DescriptorRow } from '../../../../lib/types';

export default function CallsPage({
  params,
}: {
  params: Promise<{ entity: string; chainId: string; address: string }>;
}) {
  const { entity, chainId, address } = use(params);
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [chainFilter, setChainFilter] = useState<number | null>(null);
  const chainIdNum = Number(chainId);

  const state = useAsync(
    () => makeApi().getContract(chainIdNum, address),
    [chainIdNum, address],
  );

  const allRows: DescriptorRow[] = state.status === 'ready' ? state.data : [];

  const chainIds = useMemo(
    () => [...new Set(allRows.map((r) => r.chainId))].sort((a, b) => a - b),
    [allRows],
  );

  const q = query.trim().toLowerCase();
  const filtered = filterCallRows(allRows, q).filter((r) => {
    if (kind !== 'all' && r.kind !== kind) return false;
    if (chainFilter !== null && r.chainId !== chainFilter) return false;
    return true;
  });

  const calldataCount = allRows.filter((r) => r.kind === 'calldata').length;
  const eip712Count = allRows.filter((r) => r.kind === 'eip712').length;

  function reset() {
    setQuery('');
    setKind('all');
    setChainFilter(null);
  }

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/">Home</Link>
        <span aria-hidden="true">/</span>
        <Link href={`/${entity}`}>{entity}</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">
          {chainId}:{address.slice(0, 10)}...
        </span>
      </nav>
      <div className="page-head">
        <h1 className="page-title page-title-xl">Calls</h1>
        <p className="page-sub">
          Each call has a clear-signing descriptor. Open one to contrast the raw
          calldata with its clear-signed view.
        </p>
      </div>

      <CategoryTabs
        tabs={[
          { id: 'calls', label: 'Calls', count: allRows.length },
          { id: 'calldata', label: 'calldata', count: calldataCount },
          { id: 'eip712', label: 'eip712', count: eip712Count },
        ]}
        activeId="calls"
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
          activeChainId={chainFilter}
          onKind={setKind}
          onChainId={setChainFilter}
          onReset={reset}
        />
        <div className="explore-main">
          {state.status === 'loading' ? <LoadingCard label="Loading calls" /> : null}
          {state.status === 'error' ? <ErrorCard error={state.error} /> : null}
          {state.status === 'ready' ? (
            <CallGrid
              rows={filtered}
              onSelect={(row) =>
                router.push(`/${entity}/${chainId}/${address}/${row.selector}`)
              }
            />
          ) : null}
        </div>
      </div>
    </>
  );
}
