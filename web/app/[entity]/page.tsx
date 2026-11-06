'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useState } from 'react';
import { Chrome } from '../../components/Chrome';
import { ContractGrid } from '../../components/ContractGrid';
import { ErrorCard, LoadingCard, useAsync } from '../../components/States';
import { makeApi } from '../../lib/config';
import { filterContractRows } from '../../lib/filter';

export default function ContractsPage({
  params,
}: {
  params: Promise<{ entity: string }>;
}) {
  const { entity } = use(params);
  const router = useRouter();
  const [query, setQuery] = useState('');

  const state = useAsync(
    () => makeApi().listDescriptors({ entityName: entity }),
    [entity],
  );

  const q = query.trim().toLowerCase();
  const filtered =
    state.status === 'ready' ? filterContractRows(state.data, q) : [];

  return (
    <Chrome section="companies" query={query} onQuery={setQuery}>
      <div className="crumbs">
        <Link href="/">Companies</Link>
        <span>/</span>
        <span>{entity}</span>
      </div>
      <div className="page-head">
        <h1 className="page-title">{entity}</h1>
        <p className="page-sub">Contracts mirrored for this company.</p>
      </div>

      {state.status === 'loading' ? <LoadingCard label="Loading contracts" /> : null}
      {state.status === 'error' ? <ErrorCard error={state.error} /> : null}
      {state.status === 'ready' ? (
        <ContractGrid
          rows={filtered}
          onSelect={(chainId, contract) =>
            router.push(`/${entity}/${chainId}/${contract}`)
          }
        />
      ) : null}
    </Chrome>
  );
}
