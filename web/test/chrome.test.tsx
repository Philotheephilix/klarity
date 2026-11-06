import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FilterRail } from '../components/FilterRail';

describe('FilterRail', () => {
  it('renders a chip per kind and a chainId select, and reports changes', () => {
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

    const select = screen.getByLabelText('chainId');
    expect(select).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '137' })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: '137' } });
    expect(onChainId).toHaveBeenCalledWith(137);
  });

  it('reflects the active chainId in the select value and reports min/max calls', () => {
    const onMinCalls = vi.fn();
    const onReset = vi.fn();
    render(
      <FilterRail
        chainIds={[1, 137]}
        activeKind="all"
        activeChainId={1}
        onKind={vi.fn()}
        onChainId={vi.fn()}
        minCalls=""
        maxCalls=""
        onMinCalls={onMinCalls}
        onMaxCalls={vi.fn()}
        onReset={onReset}
      />,
    );
    expect(screen.getByLabelText('chainId')).toHaveValue('1');

    fireEvent.change(screen.getByLabelText('min calls'), { target: { value: '3' } });
    expect(onMinCalls).toHaveBeenCalledWith('3');

    fireEvent.click(screen.getByRole('button', { name: /reset filter/i }));
    expect(onReset).toHaveBeenCalledOnce();
  });
});
