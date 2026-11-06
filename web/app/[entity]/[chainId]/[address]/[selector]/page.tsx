'use client';

import Link from 'next/link';
import { use } from 'react';
import { ExampleView } from '../../../../../components/ExampleView';
import { ErrorCard, LoadingCard, useAsync } from '../../../../../components/States';
import { makeApi } from '../../../../../lib/config';
import { sampleDecodeRequest } from '../../../../../lib/sample';
import type { DecodeResponse, DescriptorRow } from '../../../../../lib/types';

export default function ExamplePage({
  params,
}: {
  params: Promise<{
    entity: string;
    chainId: string;
    address: string;
    selector: string;
  }>;
}) {
  const { entity, chainId, address, selector } = use(params);
  const chainIdNum = Number(chainId);

  const state = useAsync<{ row: DescriptorRow; decode: DecodeResponse }>(
    async () => {
      const api = makeApi();
      const row = await api.getDescriptor(chainIdNum, address, selector);
      const decode = await api.decode(sampleDecodeRequest(row));
      return { row, decode };
    },
    [chainIdNum, address, selector],
  );

  return (
    <>
      <div className="crumbs">
        <Link href="/">Home</Link>
        <span>/</span>
        <Link href={`/${entity}`}>{entity}</Link>
        <span>/</span>
        <Link href={`/${entity}/${chainId}/${address}`}>
          {chainId}:{address.slice(0, 10)}...
        </Link>
        <span>/</span>
        <span>{selector}</span>
      </div>
      <div className="page-head">
        <h1 className="page-title">Blind sign vs. clear sign</h1>
        <p className="page-sub">
          Left: the raw sample calldata a wallet would otherwise ask you to sign
          blind. Right: the same call rendered from its ERC-7730 descriptor.
        </p>
      </div>

      {state.status === 'loading' ? <LoadingCard label="Decoding call" /> : null}
      {state.status === 'error' ? <ErrorCard error={state.error} /> : null}
      {state.status === 'ready' ? (
        <ExampleView row={state.data.row} decode={state.data.decode} />
      ) : null}
    </>
  );
}
