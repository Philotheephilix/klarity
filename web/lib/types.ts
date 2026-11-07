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
  // Present only when the calldata was ABI-decoded and this field's `path`
  // resolved to a concrete argument (server-side, src/routes/decode.ts). `value`
  // is a display string (decimals/bytes as-is); `type` is the ABI type.
  value?: string;
  type?: string;
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

/** The EIP-712 DescriptorWrite message signed by the authoring wallet. */
export interface DescriptorWriteMessage {
  descriptorHash: `0x${string}`;
  deadline: string;
  nonce: string;
  action: string;
}

/** Body of POST /descriptors — a signed authoritative write. */
export interface CreateDescriptorRequest {
  path: string;
  descriptor: object;
  message: DescriptorWriteMessage;
  signature: `0x${string}`;
}

/** Response of a successful POST /descriptors create/update. */
export interface CreateDescriptorResponse {
  entityKey: string;
  txHash: string;
  prUrl: string;
  attested: boolean;
  attestationUID?: string;
}
