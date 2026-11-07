import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DescriptorRow } from '../lib/types';
import { useCountUp } from '../lib/useCountUp';

// next/navigation is used by AppShell (usePathname + useRouter) and page links.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/',
}));

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
  aave: [row({ entityName: 'aave', chainId: 137, contract: '0xb1', functionName: 'supply' })],
  celo: [],
};

vi.mock('../lib/config', () => ({
  makeApi: () => ({
    listDescriptors: ({ entityName }: { entityName: string }) =>
      Promise.resolve(ROWS[entityName] ?? []),
  }),
}));

import DashboardPage from '../app/page';

async function renderDashboard() {
  const utils = render(<DashboardPage />);
  await waitFor(() => expect(screen.getByText('Total Descriptors')).toBeInTheDocument());
  return utils;
}

describe('useCountUp', () => {
  it('settles on the target (reduced-motion / jsdom path jumps straight there)', () => {
    const { result } = renderHook(() => useCountUp(42));
    expect(result.current).toBe(42);
  });

  it('is 0 for a 0 target', () => {
    const { result } = renderHook(() => useCountUp(0));
    expect(result.current).toBe(0);
  });
});

describe('Dashboard interactions', () => {
  it('bar-select: clicking a chain bar moves the tooltip + updates the analytics hint', async () => {
    const { container } = await renderDashboard();
    const chart = container.querySelector('.dash-chart') as HTMLElement;
    const bars = within(chart).getAllByRole('button');
    expect(bars.length).toBeGreaterThan(1);
    // Selecting the second bar puts the tooltip inside it and updates the hint.
    act(() => bars[1].click());
    expect(bars[1]).toHaveAttribute('data-selected', 'true');
    expect(bars[1].querySelector('.dash-bar-tooltip')).not.toBeNull();
    expect(screen.getByTestId('analytics-hint').textContent).toMatch(/descriptors/);
  });

  it('opens the Descriptors "New" modal and closes it', async () => {
    const { container } = await renderDashboard();
    const list = screen.getByRole('heading', { name: 'Descriptors' }).closest('.dash-card') as HTMLElement;
    const newBtn = within(list).getByRole('button', { name: 'New' });
    act(() => newBtn.click());
    const dialog = screen.getByRole('dialog', { name: 'Browse descriptors' });
    expect(dialog.closest('.dash-modal-backdrop')).toHaveAttribute('data-open', 'true');
    const close = within(dialog).getByRole('button', { name: 'Close dialog' });
    act(() => close.click());
    expect(dialog.closest('.dash-modal-backdrop')).toHaveAttribute('data-open', 'false');
  });
});
