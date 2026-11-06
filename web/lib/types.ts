export interface DescriptorRow {
  chainId: number;
  contract: string;
  selector: string;
  functionName?: string;
  kind: 'calldata' | 'eip712';
  intent: string;
  entityName: string;
  contractName: string;
  owner: string;
  sourcePath: string;
  eip712PrimaryType?: string;
  schemaVersion: string;
}

export interface SigningField {
  label: string;
  path: string;
  format?: string;
  hidden: boolean;
  params?: Record<string, unknown>;
}

export interface DecodeResponse {
  signing: {
    chainId: number;
    contract: string;
    selector: string;
    kind: string;
    decodedFrom: 'calldata' | 'eip712';
    contractName: string;
    functionName: string;
    intent: string;
    interpolatedIntent: string | null;
    summary: string;
  };
  fields: SigningField[];
  hiddenFields: SigningField[];
  note: string;
  raw: { calldata?: string; typedData?: unknown };
}

export interface SingleDescriptor extends DescriptorRow {
  $key: string;
  formatBlock?: Record<string, unknown>;
}

export interface DecodeRequest {
  chainId: number;
  contract: string;
  calldata?: string;
  typedData?: unknown;
  selector?: string;
}
