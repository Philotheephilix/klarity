import { fireEvent, render, screen, within, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CallGrid } from '../components/CallGrid';
import { ContractGrid } from '../components/ContractGrid';
import { RichCard } from '../components/RichCard';
import type { DescriptorRow } from '../lib/types';

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

describe('RichCard (via CallGrid)', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => cleanup());

  it('renders real metadata, a status badge, a listed-by footer, and fires onOpen', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <CallGrid
        rows={[row({ kind: 'calldata', functionName: 'deposit', selector: '0x474cf53d' })]}
        onSelect={onSelect}
      />,
    );

    // Title + selector subtitle (selector in a .mono element).
    expect(screen.getByText('deposit')).toBeInTheDocument();
    const monos = Array.from(container.querySelectorAll('.mono')).map((m) => m.textContent);
    expect(monos.some((t) => t?.includes('0x474cf53d'))).toBe(true);

    // Status badge reflects the real kind.
    const status = container.querySelector('.rich-status');
    expect(status?.textContent).toBe('calldata');

    // Two-column metadata contains real fields: kind, chain, intent, schema.
    const card = screen.getByText('deposit').closest('article')!;
    const meta = card.querySelector('.rich-meta')!;
    expect(meta.textContent).toContain('calldata');
    expect(meta.textContent).toContain('1'); // chainId
    expect(meta.textContent).toContain('v1'); // schemaVersion
    expect(within(card).getByText(/listed by aave/i)).toBeInTheDocument();

    fireEvent.click(card);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('eip712 cards surface the primary type and a pick-tone status', () => {
    const { container } = render(
      <CallGrid
        rows={[
          row({ kind: 'eip712', functionName: 'permit', selector: '0xaaaa0001', eip712PrimaryType: 'Permit' }),
        ]}
        onSelect={vi.fn()}
      />,
    );
    const status = container.querySelector('.rich-status');
    expect(status?.textContent).toBe('eip712');
    expect(status).toHaveAttribute('data-tone', 'pick');
    expect(container.querySelector('.rich-meta')?.textContent).toContain('Permit');
  });

  it('bookmark toggle flips state, persists to localStorage, and does not trigger onOpen', () => {
    const onOpen = vi.fn();
    render(
      <RichCard
        thumbKey="k"
        thumbName="WETH Gateway"
        status="clear-signed"
        statusTone="ok"
        bookmarkId="contract:1:0xabc"
        title="WETH Gateway"
        subtitle="0xd0a1...029c"
        meta={[{ label: 'chain', value: 1 }]}
        footerName="aave"
        footerSource="registry/aave/weth.json"
        onOpen={onOpen}
      />,
    );

    const mark = screen.getByRole('button', { name: /add bookmark/i });
    expect(mark).toHaveAttribute('data-on', 'false');
    fireEvent.click(mark);
    expect(screen.getByRole('button', { name: /remove bookmark/i })).toHaveAttribute('data-on', 'true');
    expect(window.localStorage.getItem('klarity-bookmarks')).toContain('contract:1:0xabc');
    // clicking the bookmark must not open the card
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe('ContractGrid rich card', () => {
  afterEach(() => cleanup());
  it('shows call count, chain and entity metadata and the contract address', () => {
    const { container } = render(
      <ContractGrid
        rows={[row({ selector: '0x11111111' }), row({ selector: '0x22222222' })]}
        onSelect={vi.fn()}
      />,
    );
    const card = screen.getByText('WETH Gateway').closest('article')!;
    const meta = card.querySelector('.rich-meta')!;
    expect(meta.textContent).toContain('2'); // two selectors -> 2 calls
    expect(meta.textContent).toContain('aave');
    expect(container.querySelector('.mono')?.textContent).toContain('0xd0a1e359');
  });
});
