import type { ReactNode } from 'react';
import { NavLink } from './NavLink';
import { SearchBar } from './SearchBar';
import { ThemeToggle } from './ThemeToggle';

export type Section = 'companies' | 'decode';

const SECTIONS: { id: Section; label: string; href: string }[] = [
  { id: 'companies', label: 'Companies', href: '/' },
  { id: 'decode', label: 'Decode', href: '/decode' },
];

export function Chrome({
  section,
  query = '',
  onQuery,
  search = true,
  children,
}: {
  section: Section;
  query?: string;
  onQuery?: (next: string) => void;
  search?: boolean;
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
        <div className="chrome-top-right">
          {search ? (
            <SearchBar
              value={query}
              onChange={onQuery ?? (() => {})}
              placeholder="Search companies, contracts, selectors"
            />
          ) : null}
          <ThemeToggle />
        </div>
      </header>
      <main className="chrome-body">{children}</main>
    </div>
  );
}
