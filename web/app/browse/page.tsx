'use client';

// The former home page (companies list) lives here now that `/` is the
// dashboard. Reuses Chrome + CompanyGrid verbatim so the browse experience and
// all deeper routes (/[entity], /[entity]/[chainId]/...) stay reachable.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CategoryTabs } from '../../components/CategoryTabs';
import { Chrome } from '../../components/Chrome';
import { CompanyGrid } from '../../components/CompanyGrid';
import { SearchBar } from '../../components/SearchBar';
import { SEED_ENTITIES } from '../../lib/entities';

export default function BrowsePage() {
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
    <Chrome section="companies" search={false}>
      <div className="crumbs">
        <span>Home</span>
        <span>/</span>
        <span>Explore</span>
      </div>
      <div className="page-head">
        <h1 className="page-title page-title-xl">Companies</h1>
        <p className="page-sub">
          Organizations with ERC-7730 clear-signing descriptors mirrored into
          the registry. Pick one to browse its contracts and calls.
        </p>
      </div>

      <CategoryTabs
        tabs={[{ id: 'companies', label: 'Companies', count: SEED_ENTITIES.length }]}
        activeId="companies"
      />

      <div className="search-wide">
        <SearchBar
          value={query}
          onChange={setQuery}
          placeholder="Search companies, contracts, selectors"
        />
      </div>

      <CompanyGrid
        entities={entities}
        onSelect={(entityName) => router.push(`/${entityName}`)}
      />
    </Chrome>
  );
}
