import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CallGrid } from '../components/CallGrid';
import { ContractGrid } from '../components/ContractGrid';
import { SearchBar } from '../components/SearchBar';
import { filterCallRows, filterContractRows } from '../lib/filter';
import type { DescriptorRow } from '../lib/types';

// next/navigation is only needed if a real page is imported; the decode page below uses next/link.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import DecodeInfoPage from '../app/decode/page';

const SEARCH_PLACEHOLDER = 'Search companies, contracts, selectors';

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

// Mirrors how the [entity] page composes SearchBar + query state + filter +
// ContractGrid inside the shared shell (the shell itself is layout-provided).
function ContractsHarness({ rows }: { rows: DescriptorRow[] }) {
  const [query, setQuery] = useState('');
  const filtered = filterContractRows(rows, query);
  return (
    <>
      <SearchBar value={query} onChange={setQuery} placeholder={SEARCH_PLACEHOLDER} />
      <ContractGrid rows={filtered} onSelect={vi.fn()} />
    </>
  );
}

// Mirrors how the calls page composes SearchBar + query state + filter + CallGrid.
function CallsHarness({ rows }: { rows: DescriptorRow[] }) {
  const [query, setQuery] = useState('');
  const filtered = filterCallRows(rows, query);
  return (
    <>
      <SearchBar value={query} onChange={setQuery} placeholder={SEARCH_PLACEHOLDER} />
      <CallGrid rows={filtered} onSelect={vi.fn()} />
    </>
  );
}

describe('filterContractRows', () => {
  it('is a no-op for an empty / whitespace query', () => {
    const rows = [row({ selector: '0x1' }), row({ selector: '0x2' })];
    expect(filterContractRows(rows, '')).toBe(rows);
    expect(filterContractRows(rows, '   ')).toBe(rows);
  });

  it('matches contractName, contract address, functionName and selector case-insensitively', () => {
    const rows = [
      row({ contractName: 'WETH Gateway', contract: '0xaaaa', selector: '0x11', functionName: 'deposit' }),
      row({ contractName: 'Lending Pool', contract: '0xbbbb', selector: '0x22', functionName: 'borrow' }),
    ];
    expect(filterContractRows(rows, 'LENDING').map((r) => r.contractName)).toEqual(['Lending Pool']);
    expect(filterContractRows(rows, '0xaaaa').map((r) => r.contractName)).toEqual(['WETH Gateway']);
    expect(filterContractRows(rows, 'borrow').map((r) => r.contractName)).toEqual(['Lending Pool']);
    expect(filterContractRows(rows, '0x11').map((r) => r.contractName)).toEqual(['WETH Gateway']);
  });
});

describe('filterCallRows', () => {
  it('is a no-op for an empty / whitespace query', () => {
    const rows = [row({ selector: '0x1' }), row({ selector: '0x2' })];
    expect(filterCallRows(rows, '')).toBe(rows);
  });

  it('matches functionName, selector and intent case-insensitively', () => {
    const rows = [
      row({ functionName: 'deposit', selector: '0x474cf53d', intent: 'Deposit into the pool' }),
      row({ functionName: 'withdraw', selector: '0x7b63e942', intent: 'Withdraw from the pool' }),
    ];
    expect(filterCallRows(rows, 'WITHDRAW').map((r) => r.functionName)).toEqual(['withdraw']);
    expect(filterCallRows(rows, '0x474cf53d').map((r) => r.functionName)).toEqual(['deposit']);
    expect(filterCallRows(rows, 'withdraw from').map((r) => r.functionName)).toEqual(['withdraw']);
  });
});

describe('Contracts list page wiring (search -> filter -> ContractGrid)', () => {
  it('typing a query hides the non-matching contract card and keeps the matching one', () => {
    render(
      <ContractsHarness
        rows={[
          row({ contract: '0xaaaa000000000000000000000000000000000001', contractName: 'WETH Gateway', selector: '0x11111111' }),
          row({ contract: '0xbbbb000000000000000000000000000000000002', contractName: 'Lending Pool', selector: '0x22222222' }),
        ]}
      />,
    );

    expect(screen.getByText('WETH Gateway')).toBeInTheDocument();
    expect(screen.getByText('Lending Pool')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), { target: { value: 'lending' } });

    expect(screen.getByText('Lending Pool')).toBeInTheDocument();
    expect(screen.queryByText('WETH Gateway')).not.toBeInTheDocument();
  });
});

describe('Calls list page wiring (search -> filter -> CallGrid)', () => {
  it('typing a query hides the non-matching call card and keeps the matching one', () => {
    render(
      <CallsHarness
        rows={[
          row({ selector: '0x474cf53d', functionName: 'deposit', intent: 'Deposit into the pool' }),
          row({ selector: '0x7b63e942', functionName: 'withdraw', intent: 'Withdraw from the pool' }),
        ]}
      />,
    );

    expect(screen.getByText('deposit')).toBeInTheDocument();
    expect(screen.getByText('withdraw')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), { target: { value: 'withdraw' } });

    expect(screen.getByText('withdraw')).toBeInTheDocument();
    expect(screen.queryByText('deposit')).not.toBeInTheDocument();
  });
});

describe('No-list pages hide the inert SearchBar', () => {
  it('decode info page renders no promise-everything search input', () => {
    render(<DecodeInfoPage />);
    expect(screen.getByRole('heading', { name: 'Decode' })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(SEARCH_PLACEHOLDER)).not.toBeInTheDocument();
  });
});
