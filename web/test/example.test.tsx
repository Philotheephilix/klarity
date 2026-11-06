import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ExampleView } from '../components/ExampleView';
import type { DecodeResponse, DescriptorRow } from '../lib/types';

const NOTE =
  'Labels and intent come from the ERC-7730 descriptor. Argument values are not ABI-decoded.';

const calldataRow: DescriptorRow = {
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
};

const eip712Row: DescriptorRow = {
  ...calldataRow,
  kind: 'eip712',
  eip712PrimaryType: 'Order',
  selector: '0x7b63e942',
  functionName: 'fillOrder',
};

function decode(
  fields: DecodeResponse['fields'],
  hidden: DecodeResponse['hiddenFields'] = [],
  overrides: Partial<DecodeResponse> = {},
): DecodeResponse {
  return {
    signing: {
      chainId: 1,
      contract: calldataRow.contract,
      selector: calldataRow.selector,
      kind: 'calldata',
      decodedFrom: 'calldata',
      contractName: 'WETH Gateway',
      functionName: 'deposit',
      intent: 'Deposit into the pool',
      interpolatedIntent: null,
      summary: 'Deposit 1 ETH into the WETH Gateway',
    },
    fields,
    hiddenFields: hidden,
    note: NOTE,
    raw: { calldata: '0x474cf53daaaaaaaa' },
    ...overrides,
  };
}

describe('ExampleView', () => {
  it('renders sample hex, summary, visible field labels, and the note verbatim', () => {
    const { container } = render(
      <ExampleView
        row={calldataRow}
        decode={decode(
          [
            { label: 'Pool', path: '#.pool', format: 'addressName', hidden: false },
            { label: 'Amount', path: '#.amount', format: 'tokenAmount', hidden: false },
          ],
          [{ label: 'Nonce', path: '#.nonce', hidden: true }],
        )}
      />,
    );

    const code = container.querySelector('.code-block');
    expect(code?.textContent).toContain('0x474cf53d');
    expect(screen.getByText('Deposit 1 ETH into the WETH Gateway')).toBeInTheDocument();
    expect(screen.getByText('Pool')).toBeInTheDocument();
    expect(screen.getByText('Amount')).toBeInTheDocument();
    expect(screen.getByText(NOTE)).toBeInTheDocument();
  });

  it('shows the labels-unavailable state when decode has no fields', () => {
    render(<ExampleView row={calldataRow} decode={decode([])} />);
    expect(screen.getByText(/clear-sign labels unavailable for this row/i)).toBeInTheDocument();
    expect(screen.queryByText('Pool')).not.toBeInTheDocument();
  });

  it('renders the typedData skeleton (not a hex) for an eip712 row', () => {
    const { container } = render(
      <ExampleView
        row={eip712Row}
        decode={decode([{ label: 'Maker', path: '#.maker', hidden: false }], [], {
          signing: {
            chainId: 1,
            contract: eip712Row.contract,
            selector: eip712Row.selector,
            kind: 'eip712',
            decodedFrom: 'eip712',
            contractName: 'Aggregation Router',
            functionName: 'fillOrder',
            intent: 'Fill an order',
            interpolatedIntent: null,
            summary: 'Fill an order',
          },
          raw: { typedData: { primaryType: 'Order' } },
        })}
      />,
    );
    const code = container.querySelector('.code-block');
    expect(code?.textContent).toContain('primaryType');
    expect(code?.textContent).not.toMatch(/^0x[0-9a-f]+$/);
  });
});

describe('two-panel component sources', () => {
  it('contain no emoji', () => {
    const files = ['ExampleView.tsx', 'RawPanel.tsx', 'ClearSignPanel.tsx'];
    const emoji =
      /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F1FF}]/u;
    for (const f of files) {
      const src = readFileSync(resolve(__dirname, '../components', f), 'utf8');
      expect(src, `${f} must contain no emoji`).not.toMatch(emoji);
    }
  });
});
