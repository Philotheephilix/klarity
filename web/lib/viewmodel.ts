import type { DecodeResponse, DescriptorRow, SigningField } from './types';

export interface ClearSignVM {
  summary: string;
  contractName: string;
  functionName: string;
  kind: string;
  visibleFields: SigningField[];
  hiddenFields: SigningField[];
  note: string;
  hasFields: boolean;
}

export interface RawPanelVM {
  mode: 'calldata' | 'eip712';
  hex?: string;
  typedData?: unknown;
  selector: string;
  chainId: number;
  contract: string;
}

export function toClearSignVM(d: DecodeResponse): ClearSignVM {
  return {
    summary: d.signing.summary,
    contractName: d.signing.contractName,
    functionName: d.signing.functionName,
    kind: d.signing.kind,
    visibleFields: d.fields,
    hiddenFields: d.hiddenFields,
    note: d.note,
    hasFields: d.fields.length > 0,
  };
}

export function rawPanelVM(
  row: DescriptorRow,
  req: { calldata?: string; typedData?: unknown },
): RawPanelVM {
  const base = {
    selector: row.selector,
    chainId: row.chainId,
    contract: row.contract,
  };
  if (req.typedData !== undefined || row.kind === 'eip712') {
    return { ...base, mode: 'eip712', typedData: req.typedData };
  }
  return { ...base, mode: 'calldata', hex: req.calldata };
}
