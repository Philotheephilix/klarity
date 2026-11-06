import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Chrome } from '../components/Chrome';
import { FilterRail } from '../components/FilterRail';

describe('Chrome', () => {
  it('renders nav.bench-nav, marks the active section, and reports search input', () => {
    const onQuery = vi.fn();
    const { container } = render(
      <Chrome section="companies" query="" onQuery={onQuery}>
        <div>body</div>
      </Chrome>,
    );
    const nav = container.querySelector('nav.bench-nav');
    expect(nav).not.toBeNull();

    const companies = screen.getByRole('link', { name: 'Companies' });
    expect(companies).toHaveAttribute('data-on', 'true');
    const decode = screen.getByRole('link', { name: 'Decode' });
    expect(decode).toHaveAttribute('data-on', 'false');

    fireEvent.change(screen.getByPlaceholderText(/search/i), {
      target: { value: 'safe' },
    });
    expect(onQuery).toHaveBeenCalledWith('safe');
    expect(screen.getByText('body')).toBeInTheDocument();
  });
});

describe('FilterRail', () => {
  it('renders a chip per kind and chainId and reports kind clicks', () => {
    const onKind = vi.fn();
    const onChainId = vi.fn();
    render(
      <FilterRail
        chainIds={[1, 137]}
        activeKind="all"
        activeChainId={null}
        onKind={onKind}
        onChainId={onChainId}
      />,
    );

    const all = screen.getByRole('button', { name: 'All' });
    expect(all).toHaveAttribute('data-on', 'true');

    const calldata = screen.getByRole('button', { name: 'calldata' });
    expect(calldata).toHaveAttribute('data-on', 'false');
    fireEvent.click(calldata);
    expect(onKind).toHaveBeenCalledWith('calldata');

    expect(screen.getByRole('button', { name: 'eip712' })).toBeInTheDocument();
    const chain = screen.getByRole('button', { name: '137' });
    fireEvent.click(chain);
    expect(onChainId).toHaveBeenCalledWith(137);
  });

  it('marks the active chainId chip', () => {
    render(
      <FilterRail
        chainIds={[1, 137]}
        activeKind="all"
        activeChainId={1}
        onKind={vi.fn()}
        onChainId={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: '1' })).toHaveAttribute('data-on', 'true');
  });
});
