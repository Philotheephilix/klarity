'use client';

import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ThemeToggle } from './ThemeToggle';
import { ToastProvider, useToast } from './Toasts';
import {
  KlarityMark,
  IconDashboard,
  IconEntities,
  IconContracts,
  IconCalls,
  IconChains,
  IconSettings,
  IconHelp,
  IconMail,
  IconBell,
  IconBook,
} from './icons';

// Routing choices for the sidebar. Since `/` is now the dashboard, the old
// companies list lives at `/browse`. Entity/Contracts/Calls/Chains deep-link
// into real, kept routes: Entities -> /browse (the companies list), and the
// data-shaped links point at a featured entity that actually has data (1inch),
// whose [entity] page renders its contracts/calls grids. No link 404s.
const FEATURED_ENTITY = '1inch';

const MENU_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', href: '/', Icon: IconDashboard },
  { id: 'entities', label: 'Entities', href: '/browse', Icon: IconEntities },
  {
    id: 'contracts',
    label: 'Contracts',
    href: `/${FEATURED_ENTITY}`,
    Icon: IconContracts,
  },
  {
    id: 'calls',
    label: 'Calls',
    href: `/${FEATURED_ENTITY}`,
    Icon: IconCalls,
  },
  { id: 'chains', label: 'Chains', href: '/browse', Icon: IconChains },
] as const;

export type MenuId = (typeof MENU_ITEMS)[number]['id'];

function Sidebar({ active }: { active: MenuId }) {
  const toast = useToast();
  return (
    <aside className="dash-sidebar">
      <button
        type="button"
        className="dash-brand"
        onClick={() => toast.show('Klarity explorer — mirrored registry in sync')}
        title="Klarity"
      >
        <KlarityMark size={30} />
        <span className="dash-wordmark">Klarity</span>
      </button>

      <nav className="dash-nav" aria-label="Primary">
        <div className="dash-nav-group">MENU</div>
        {MENU_ITEMS.map(({ id, label, href, Icon }) => (
          <a
            key={id}
            href={href}
            className="dash-nav-link"
            data-on={id === active ? 'true' : 'false'}
            aria-current={id === active ? 'page' : undefined}
          >
            <span className="dash-nav-ico">
              <Icon size={18} />
            </span>
            {label}
          </a>
        ))}

        <div className="dash-nav-group dash-nav-group-gap">GENERAL</div>
        <a href="/" className="dash-nav-link" title="Settings" aria-label="Settings">
          <span className="dash-nav-ico">
            <IconSettings size={18} />
          </span>
          Settings
        </a>
        <a href="/" className="dash-nav-link" title="Help" aria-label="Help">
          <span className="dash-nav-ico">
            <IconHelp size={18} />
          </span>
          Help
        </a>
        <div className="dash-nav-theme">
          <ThemeToggle />
        </div>
      </nav>

      <div className="dash-promo">
        <svg
          className="dash-promo-art"
          viewBox="0 0 120 70"
          aria-hidden="true"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="klPromo" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="var(--ok)" stopOpacity="0.9" />
              <stop offset="1" stopColor="var(--pick)" stopOpacity="0.75" />
            </linearGradient>
          </defs>
          <rect width="120" height="70" fill="url(#klPromo)" />
          <circle cx="92" cy="14" r="26" fill="rgba(255,255,255,0.18)" />
          <circle cx="24" cy="60" r="20" fill="rgba(255,255,255,0.12)" />
        </svg>
        <div className="dash-promo-body">
          <div className="dash-promo-title">Read the API docs</div>
          <p className="dash-promo-sub">
            Query the ERC-7730 registry from your own tools.
          </p>
          <a className="dash-promo-btn" href="/decode">
            <IconBook size={16} />
            API Docs
          </a>
        </div>
      </div>
    </aside>
  );
}

// Static quick-jump targets for the live search dropdown. Kept to real, kept
// routes so selecting one never 404s.
const SEARCH_ITEMS: { title: string; sub: string; href: string }[] = [
  { title: '1inch', sub: 'Entity · mirrored corpus', href: '/1inch' },
  { title: 'Aave', sub: 'Entity · mirrored corpus', href: '/aave' },
  { title: 'Celo', sub: 'Entity · mirrored corpus', href: '/celo' },
  { title: 'Browse registry', sub: 'All entities', href: '/browse' },
  { title: 'Decode calldata', sub: 'API playground', href: '/decode' },
];

function TopBar() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return SEARCH_ITEMS.slice(0, 5);
    return SEARCH_ITEMS.filter(
      (i) =>
        i.title.toLowerCase().includes(query) ||
        i.sub.toLowerCase().includes(query),
    );
  }, [q]);

  // ⌘F / Ctrl+F focuses the search + opens the dropdown; Escape closes it.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Close on outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  function go(href: string, title: string) {
    setOpen(false);
    toast.show(`Opening ${title}`);
    router.push(href);
  }

  return (
    <header className="dash-topbar">
      <div className="dash-search-wrap" ref={containerRef}>
        <form
          className="dash-search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            if (results[0]) go(results[0].href, results[0].title);
            else router.push('/browse');
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            className="dash-search-box"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Search entities, contracts, selectors"
            aria-label="Search the registry"
            autoComplete="off"
          />
          <kbd className="dash-kbd">{'⌘F'}</kbd>
        </form>

        {open ? (
          <div className="dash-search-dropdown" role="listbox" aria-label="Search results">
            <div className="dash-search-dropdown-label">Quick jump</div>
            {results.length ? (
              results.map((r) => (
                <button
                  type="button"
                  className="dash-search-result"
                  key={r.href + r.title}
                  role="option"
                  aria-selected="false"
                  onClick={() => go(r.href, r.title)}
                >
                  <span className="dash-search-result-text">
                    <span className="dash-search-result-title">{r.title}</span>
                    <span className="dash-search-result-sub">{r.sub}</span>
                  </span>
                  <span className="dash-search-result-jump">Jump ↗</span>
                </button>
              ))
            ) : (
              <div className="dash-search-empty">No matches found</div>
            )}
          </div>
        ) : null}
      </div>

      <div className="dash-topbar-right">
        <button
          type="button"
          className="dash-icon-btn"
          title="Mail"
          aria-label="Mail"
          onClick={() => toast.show('No messages — this is a read-only explorer')}
        >
          <IconMail size={20} />
        </button>
        <button
          type="button"
          className="dash-icon-btn"
          title="Notifications"
          aria-label="Notifications"
          onClick={() => toast.show('Registry mirror is up to date')}
        >
          <IconBell size={20} />
        </button>
        <div className="dash-user">
          <span className="dash-avatar" aria-hidden="true">
            KL
          </span>
          <span className="dash-user-text">
            <span className="dash-user-name">Klarity</span>
            <span className="dash-user-mail">explorer@klarity.local</span>
          </span>
        </div>
      </div>
    </header>
  );
}

/**
 * Persistent dashboard chrome: a rounded app-frame outer shell on a soft page,
 * a fixed left sidebar + a scrollable main column with a top bar. Separate from
 * Chrome.tsx (which still drives the browse pages) so neither layout breaks the
 * other. Wrapped in ToastProvider so any child can raise a toast.
 */
export function DashboardShell({
  active = 'dashboard',
  children,
}: {
  active?: MenuId;
  children: ReactNode;
}) {
  return (
    <ToastProvider>
      <div className="dash-page">
        <div className="dash-frame">
          <Sidebar active={active} />
          <div className="dash-main">
            <TopBar />
            <main className="dash-content">{children}</main>
          </div>
        </div>
      </div>
    </ToastProvider>
  );
}
