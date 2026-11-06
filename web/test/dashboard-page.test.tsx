import { render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { DescriptorRow } from '../lib/types';

// next/navigation is used by AppShell's sidebar (usePathname) + top-bar search
// (useRouter) and the page's own links.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/',
}));

// Stub the API client the same way the data hook reaches it: makeApi() returns
// an object with listDescriptors(). We return known rows per entity so the
// rendered KPI numbers are assertable.
function row(partial: Partial<DescriptorRow>): DescriptorRow {
  return {
    chainId: 1,
    contract: '0xaaaa000000000000000000000000000000000001',
    selector: '0x11111111',
    functionName: 'swap',
    kind: 'calldata',
    intent: 'Swap tokens',
    entityName: '1inch',
    contractName: 'Router',
    owner: '1inch',
    sourcePath: 'registry/1inch/router.json',
    schemaVersion: '1',
    ...partial,
  };
}

const ROWS: Record<string, DescriptorRow[]> = {
  '1inch': [
    row({ chainId: 1, contract: '0xa1', functionName: 'swap', kind: 'eip712' }),
    row({ chainId: 10, contract: '0xa2', selector: '0x22', functionName: 'unoswap' }),
  ],
  aave: [
    row({ entityName: 'aave', chainId: 137, contract: '0xb1', functionName: 'supply' }),
  ],
  celo: [],
};

vi.mock('../lib/config', () => ({
  makeApi: () => ({
    listDescriptors: ({ entityName }: { entityName: string }) =>
      Promise.resolve(ROWS[entityName] ?? []),
  }),
}));

import DashboardPage from '../app/page';
import { AppShell } from '../components/AppShell';

async function renderDashboard() {
  // The sidebar/top-bar chrome now lives in the shared AppShell (mounted by
  // app/layout.tsx). Render the page inside it so the chrome assertions below
  // reflect what a real route sees.
  const utils = render(
    <AppShell>
      <DashboardPage />
    </AppShell>,
  );
  // Wait for the async data hook to resolve past the loading card.
  await waitFor(() => expect(screen.getByText('Total Descriptors')).toBeInTheDocument());
  return utils;
}

describe('Dashboard home', () => {
  it('renders the sidebar: logo wordmark, MENU + GENERAL groups, promo', async () => {
    const { container } = await renderDashboard();
    expect(container.querySelector('.dash-wordmark')).toHaveTextContent('Klarity');
    expect(screen.getByText('MENU')).toBeInTheDocument();
    expect(screen.getByText('GENERAL')).toBeInTheDocument();
    expect(screen.getByText('Read the API docs')).toBeInTheDocument();
    expect(container.querySelector('.kl-mark')).not.toBeNull();
    // nav links point at kept routes
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Entities' })).toHaveAttribute('href', '/browse');
  });

  it('renders the top bar: search with cmd chip, mail + bell, user block', async () => {
    await renderDashboard();
    expect(screen.getByPlaceholderText(/Search entities/)).toBeInTheDocument();
    expect(screen.getByText('⌘F')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mail' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.getByText('explorer@klarity.local')).toBeInTheDocument();
    // avatar is plain initials, not an image
    expect(screen.getByText('KL')).toBeInTheDocument();
  });

  it('renders the page head with title and the two action buttons', async () => {
    const { container } = await renderDashboard();
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    const head = container.querySelector('.dash-head')!;
    expect(within(head as HTMLElement).getByRole('link', { name: 'Browse Registry' }))
      .toHaveAttribute('href', '/browse');
    expect(within(head as HTMLElement).getByRole('link', { name: 'API Docs' }))
      .toBeInTheDocument();
  });

  it('renders 4 stat tiles whose numbers reflect the mocked API rows', async () => {
    const { container } = await renderDashboard();
    const stats = container.querySelector('.dash-stats') as HTMLElement;
    const tiles = Array.from(stats.querySelectorAll('.dash-stat')) as HTMLElement[];
    expect(tiles).toHaveLength(4);
    const tile = (label: string) =>
      tiles.find((t) => t.textContent?.includes(label))!;
    // total = 2 + 1 + 0 = 3
    expect(tile('Total Descriptors')).toHaveTextContent('3');
    // entities with data = 2 (1inch, aave)
    expect(tile('Entities')).toHaveTextContent('2');
    // distinct contracts = 0xa1, 0xa2, 0xb1 = 3
    expect(tile('Contracts')).toHaveTextContent('3');
    // distinct chains = 1, 10, 137 = 3
    expect(tile('Chains')).toHaveTextContent('3');
  });

  it('renders analytics chart, featured card, descriptors list', async () => {
    const { container } = await renderDashboard();
    expect(screen.getByText('Registry Analytics')).toBeInTheDocument();
    expect(container.querySelector('.dash-chart')).not.toBeNull();
    expect(screen.getByText('Featured Entity')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Descriptors' })).toBeInTheDocument();
    // a real row title from the mocked data
    expect(screen.getByText('swap')).toBeInTheDocument();
  });

  it('does not render the removed Top Entities, Verification gauge, or Sync Status cards', async () => {
    const { container } = await renderDashboard();
    expect(screen.queryByText('Top Entities')).toBeNull();
    expect(container.querySelector('.dash-pill')).toBeNull();
    expect(screen.queryByText('Verification')).toBeNull();
    expect(container.querySelector('.dash-gauge-svg')).toBeNull();
    expect(screen.queryByText('Sync Status')).toBeNull();
    expect(container.querySelector('.dash-sync-digits')).toBeNull();
    expect(container.querySelector('.dash-grid-bot')).not.toBeNull();
  });

  it('renders the Descriptors list as the last content section (bottom of page)', async () => {
    const { container } = await renderDashboard();
    const list = screen.getByRole('heading', { name: 'Descriptors' }).closest('.dash-card') as HTMLElement;
    // The descriptors list lives in the bottom grid, and that grid is the last
    // content section rendered in the dashboard body.
    const bottom = container.querySelector('.dash-grid-bot') as HTMLElement;
    expect(bottom.contains(list)).toBe(true);
    const sections = Array.from(container.querySelectorAll('section'));
    expect(sections[sections.length - 1]).toBe(bottom);
    // The descriptors list must NOT sit in the middle grid any more.
    const mid = container.querySelector('.dash-grid-mid') as HTMLElement;
    expect(mid.contains(list)).toBe(false);
  });

  it('contains no third-party product name and uses no <img> avatars', async () => {
    const { container } = await renderDashboard();
    expect(container.querySelector('img')).toBeNull();
    // guard against reintroducing the reference product name anywhere in source
    const files = [
      '../app/page.tsx',
      '../components/AppShell.tsx',
      '../components/icons.tsx',
    ];
    for (const f of files) {
      const src = readFileSync(resolve(__dirname, f), 'utf8');
      expect(src.toLowerCase(), `${f} must not mention the reference product`).not.toContain('donezo');
    }
  });
});
