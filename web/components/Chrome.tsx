import type { ReactNode } from 'react';
import { NavLink } from './NavLink';
import { SearchBar } from './SearchBar';

export type Section = 'companies' | 'decode';

const SECTIONS: { id: Section; label: string; href: string }[] = [
  { id: 'companies', label: 'Companies', href: '/' },
  { id: 'decode', label: 'Decode', href: '/decode' },
];

export function Chrome({
  section,
  query,
  onQuery,
  children,
}: {
  section: Section;
  query: string;
  onQuery: (next: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="chrome">
      <header className="chrome-top">
        <nav className="bench-nav">
          {SECTIONS.map((s) => (
            <NavLink key={s.id} href={s.href} active={s.id === section}>
              {s.label}
            </NavLink>
          ))}
        </nav>
        <SearchBar value={query} onChange={onQuery} placeholder="Search companies, contracts, selectors" />
      </header>
      <main className="chrome-body">{children}</main>
    </div>
  );
}
