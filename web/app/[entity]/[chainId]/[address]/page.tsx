'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useState } from 'react';
import { CallGrid } from '../../../../components/CallGrid';
import { Chrome } from '../../../../components/Chrome';
import { ErrorCard, LoadingCard, useAsync } from '../../../../components/States';
import { makeApi } from '../../../../lib/config';
import { filterCallRows } from '../../../../lib/filter';

export default function CallsPage({
  params,
}: {
  params: Promise<{ entity: string; chainId: string; address: string }>;
}) {
  const { entity, chainId, address } = use(params);
  const router = useRouter();
  const [query, setQuery] = useState('');
  const chainIdNum = Number(chainId);

  const state = useAsync(
    () => makeApi().getContract(chainIdNum, address),
    [chainIdNum, address],
  );

  const q = query.trim().toLowerCase();
  const filtered = state.status === 'ready' ? filterCallRows(state.data, q) : [];

  return (
    <Chrome section="companies" query={query} onQuery={setQuery}>
      <div className="crumbs">
        <Link href="/">Companies</Link>
        <span>/</span>
        <Link href={`/${entity}`}>{entity}</Link>
        <span>/</span>
        <span>
          {chainId}:{address.slice(0, 10)}...
        </span>
      </div>
      <div className="page-head">
        <h1 className="page-title">Calls</h1>
        <p className="page-sub">
          Each call has a clear-signing descriptor. Open one to contrast the raw
          calldata with its clear-signed view.
        </p>
      </div>

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
    </Chrome>
  );
}
