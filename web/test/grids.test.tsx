import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CallGrid } from '../components/CallGrid';
import { CompanyGrid } from '../components/CompanyGrid';
import { ContractGrid } from '../components/ContractGrid';
import type { SeedEntity } from '../lib/entities';
import type { DescriptorRow } from '../lib/types';

const ENTITIES: SeedEntity[] = [
  { entityName: 'aave', displayName: 'Aave' },
  { entityName: 'safe', displayName: 'Safe' },
];

function row(partial: Partial<DescriptorRow>): DescriptorRow {
  return {
    chainId: 1,
    contract: '0xd0a1e359811322d97991e03f863a0c30c2cf029c',
    selector: '0x474cf53d',
    functionName: 'deposit',
    kind: 'calldata',
    intent: 'Deposit into the pool',
    entityName: 'aave',
    contractName: 'WETH Gateway',
    owner: 'aave',
    sourcePath: 'registry/aave/weth.json',
    schemaVersion: '1',
    ...partial,
  };
}

describe('CompanyGrid', () => {
  it('renders a card per entity and reports selection', () => {
    const onSelect = vi.fn();
    render(<CompanyGrid entities={ENTITIES} onSelect={onSelect} />);
    expect(screen.getByText('Aave')).toBeInTheDocument();
    expect(screen.getByText('Safe')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Aave').closest('article')!);
    expect(onSelect).toHaveBeenCalledWith('aave');
  });
});

describe('ContractGrid', () => {
  it('renders an empty-state card when there are no rows', () => {
    render(<ContractGrid rows={[]} onSelect={vi.fn()} />);
    expect(screen.getByText(/no mirrored contracts/i)).toBeInTheDocument();
  });

  it('renders a card per grouped contract with the address in a .mono element', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <ContractGrid
        rows={[row({ selector: '0x11111111' }), row({ selector: '0x22222222' })]}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByText('WETH Gateway')).toBeInTheDocument();
    const mono = container.querySelector('.mono');
    expect(mono?.textContent).toContain('0xd0a1e359');
    fireEvent.click(screen.getByText('WETH Gateway').closest('article')!);
    expect(onSelect).toHaveBeenCalledWith(1, '0xd0a1e359811322d97991e03f863a0c30c2cf029c');
  });
});

describe('CallGrid', () => {
  it('renders a card per selector with the selector in a .mono element', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <CallGrid rows={[row({ selector: '0x474cf53d', functionName: 'deposit' })]} onSelect={onSelect} />,
    );
    expect(screen.getByText('deposit')).toBeInTheDocument();
    const monos = Array.from(container.querySelectorAll('.mono')).map((m) => m.textContent);
    expect(monos.some((t) => t?.includes('0x474cf53d'))).toBe(true);
    fireEvent.click(screen.getByText('deposit').closest('article')!);
    expect(onSelect).toHaveBeenCalledWith(row({ selector: '0x474cf53d', functionName: 'deposit' }));
  });
});
