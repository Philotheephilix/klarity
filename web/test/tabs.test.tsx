import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CategoryTabs } from '../components/CategoryTabs';

describe('CategoryTabs', () => {
  const tabs = [
    { id: 'contracts', label: 'Contracts', count: 3 },
    { id: 'calls', label: 'Calls', count: 12 },
  ];

  it('renders a tab per category with its count and marks the active one', () => {
    render(<CategoryTabs tabs={tabs} activeId="contracts" />);

    const contracts = screen.getByRole('tab', { name: /contracts/i });
    expect(contracts).toHaveAttribute('data-on', 'true');
    expect(contracts).toHaveAttribute('aria-selected', 'true');
    expect(contracts.textContent).toContain('3');

    const calls = screen.getByRole('tab', { name: /calls/i });
    expect(calls).toHaveAttribute('data-on', 'false');
    expect(calls.textContent).toContain('12');
  });

  it('reports selection when a tab is clicked', () => {
    const onSelect = vi.fn();
    render(<CategoryTabs tabs={tabs} activeId="contracts" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('tab', { name: /calls/i }));
    expect(onSelect).toHaveBeenCalledWith('calls');
  });
});
