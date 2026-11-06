'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Chrome } from '../components/Chrome';
import { CompanyGrid } from '../components/CompanyGrid';
import { SEED_ENTITIES } from '../lib/entities';

export default function CompaniesPage() {
  const router = useRouter();
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const entities = q
    ? SEED_ENTITIES.filter(
        (e) =>
          e.entityName.includes(q) || e.displayName.toLowerCase().includes(q),
      )
    : SEED_ENTITIES;

  return (
    <Chrome section="companies" query={query} onQuery={setQuery}>
      <div className="page-head">
        <h1 className="page-title">Companies</h1>
        <p className="page-sub">
          Organizations with ERC-7730 clear-signing descriptors mirrored into
          the registry. Pick one to browse its contracts and calls.
        </p>
      </div>
      <CompanyGrid
        entities={entities}
        onSelect={(entityName) => router.push(`/${entityName}`)}
      />
    </Chrome>
  );
}
