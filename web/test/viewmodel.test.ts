import { describe, expect, it } from 'vitest';
import { rawPanelVM, toClearSignVM } from '../lib/viewmodel';
import type { DecodeResponse, DescriptorRow } from '../lib/types';

const NOTE =
  'Labels and intent come from the ERC-7730 descriptor. Argument values are not ABI-decoded.';

function decode(fields: DecodeResponse['fields'], hidden: DecodeResponse['hiddenFields'] = []): DecodeResponse {
  return {
    signing: {
      chainId: 1,
      contract: '0xd0a1e359811322d97991e03f863a0c30c2cf029c',
      selector: '0x474cf53d',
      kind: 'calldata',
      decodedFrom: 'calldata',
      contractName: 'WETH Gateway',
      functionName: 'deposit',
      intent: 'Deposit',
      interpolatedIntent: null,
      summary: 'Deposit into the pool',
    },
    fields,
    hiddenFields: hidden,
    note: NOTE,
    raw: { calldata: '0x474cf53d' },
  };
}

const row: DescriptorRow = {
  chainId: 1,
  contract: '0xd0a1e359811322d97991e03f863a0c30c2cf029c',
  selector: '0x474cf53d',
  functionName: 'deposit',
  kind: 'calldata',
  intent: 'Deposit',
  entityName: 'aave',
  contractName: 'WETH Gateway',
  owner: 'aave',
  sourcePath: 'registry/aave/weth.json',
  schemaVersion: '1',
};

describe('toClearSignVM', () => {
  it('splits visible/hidden, sets hasFields true, copies note verbatim', () => {
    const vm = toClearSignVM(
      decode(
        [
          { label: 'Pool', path: '#.pool', hidden: false },
          { label: 'Amount', path: '#.amount', hidden: false },
        ],
        [{ label: 'Nonce', path: '#.nonce', hidden: true }],
      ),
    );
    expect(vm.hasFields).toBe(true);
    expect(vm.visibleFields).toHaveLength(2);
    expect(vm.hiddenFields).toHaveLength(1);
    expect(vm.note).toBe(NOTE);
    expect(vm.summary).toBe('Deposit into the pool');
    expect(vm.contractName).toBe('WETH Gateway');
    expect(vm.functionName).toBe('deposit');
  });

  it('sets hasFields false when fields is empty', () => {
    const vm = toClearSignVM(decode([]));
    expect(vm.hasFields).toBe(false);
    expect(vm.visibleFields).toHaveLength(0);
  });
});

describe('rawPanelVM', () => {
  it('calldata request yields mode calldata with hex', () => {
    const vm = rawPanelVM(row, { calldata: '0x474cf53dabc' });
    expect(vm.mode).toBe('calldata');
    expect(vm.hex).toBe('0x474cf53dabc');
    expect(vm.typedData).toBeUndefined();
    expect(vm.selector).toBe('0x474cf53d');
    expect(vm.chainId).toBe(1);
    expect(vm.contract).toBe(row.contract);
  });

  it('typedData request yields mode eip712 with typedData', () => {
    const td = { primaryType: 'Order' };
    const vm = rawPanelVM({ ...row, kind: 'eip712' }, { typedData: td });
    expect(vm.mode).toBe('eip712');
    expect(vm.typedData).toBe(td);
    expect(vm.hex).toBeUndefined();
  });
});
