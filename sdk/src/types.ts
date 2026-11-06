// Response/request types for @klarity/sdk, mirroring docs/API.md.
// Type-only module — no runtime logic.

/** A single ERC-7730 clear-signing format block (inlined on the single-descriptor route). */
export interface FormatBlock {
  $id?: string;
  intent?: string;
  fields?: FormatBlockField[];
  [key: string]: unknown;
}

export interface FormatBlockField {
  format?: string;
  label?: string;
  path?: string;
  params?: Record<string, unknown>;
  [key: string]: unknown;
}

/** A descriptor row as returned by the read routes (body/bodyHash stripped). */
export interface Descriptor {
  $key: string;
  chainId: number;
  contract: string;
  selector: string;
  functionName?: string;
  kind: string;
  intent?: string;
  entityName?: string;
  contractName?: string;
  owner?: string;
  sourcePath?: string;
  source?: string;
  contentHash?: string;
  schemaVersion?: string;
  eip712PrimaryType?: string;
  functionSignature?: string;
  /** EF-tier attestation columns (additive; present once attested). */
  attestationUID?: string;
  attester?: string;
  /** Two-tier verified block, surfaced on the single-descriptor route (Task 8). */
  verified?: VerifiedBlock;
}

/** The single-descriptor route additionally inlines the decoded, hash-verified body. */
export interface DescriptorWithFormatBlock extends Descriptor {
  formatBlock?: FormatBlock;
}

/** POST /decode request — one of two input modes. */
export interface DecodeRequestCalldata {
  chainId: number;
  contract: string;
  calldata: string;
  selector?: string;
}

export interface DecodeRequestTypedData {
  chainId: number;
  contract: string;
  typedData: {
    primaryType: string;
    types: Record<string, Array<{ name: string; type: string }>>;
    message?: Record<string, unknown>;
    [key: string]: unknown;
  };
  selector?: string;
}

export type DecodeRequest = DecodeRequestCalldata | DecodeRequestTypedData;

/** The signing summary block of a /decode response. */
export interface DecodeSigning {
  chainId: number;
  contract: string;
  selector: string;
  kind: 'calldata' | 'eip712';
  decodedFrom: string;
  contractName?: string;
  functionName?: string;
  /** Canonical (name-bearing) function signature the calldata was decoded against. */
  functionSignature?: string;
  intent?: string;
  interpolatedIntent: string | null;
  summary: string;
}

/** A labeled field in a /decode response (visible or hidden). */
export interface SigningField {
  label: string;
  path: string;
  format?: string;
  hidden: boolean;
  params?: Record<string, unknown>;
  /**
   * Canonical string form of the decoded argument at `path` (base-10 for
   * integers, checksummed hex for addresses, 0x-hex for bytes). Present only
   * when the calldata was ABI-decoded and the path resolved.
   */
  value?: string;
  /** ABI type of the decoded argument at `path` (e.g. `uint256`, `address`). */
  type?: string;
  /**
   * For a wrapper call (1inch `permitAndCall`), the recursively-decoded inner
   * call carried in the `action` bytes. Attached to the field whose `path`
   * maps to the inner-call argument. When the inner selector has no descriptor
   * or its bytes are malformed, `inner.unresolved` is `true` and the snap
   * renders it as an honest "unknown inner call" with the raw selector.
   */
  inner?: DecodeResponse;
  /**
   * For a wrapper call (1inch `permitAndCall`), the decoded permit payload
   * carried in the `permit` bytes. Attached to the field whose `path` maps to
   * the permit argument.
   */
  permit?: PermitDecoded;
}

/** A decoded ERC-20 permit payload (mirrors `src/decode/permit.ts`). */
export interface PermitDecoded {
  format: 'eip2612' | 'dai' | 'permit2' | 'unknown';
  fields: { label: string; value: string }[];
  raw: string;
}

/** POST /decode response shape. */
export interface DecodeResponse {
  signing: DecodeSigning;
  fields: SigningField[];
  hiddenFields: SigningField[];
  note: string;
  raw: { calldata?: string; typedData?: unknown };
  /** Echoed function signature, when the descriptor carried one. */
  functionSignature?: string;
  /**
   * Set on an `inner` sub-response when the inner call could not be resolved
   * (no descriptor for the inner selector, or malformed inner bytes). The
   * snap renders this as an honest "unknown inner call" carrying only the raw
   * selector — never a silent drop.
   */
  unresolved?: boolean;
}

/** A verified public vouch (Tier 2) — an interaction-proven attestation. */
export interface PublicVouch {
  attester: string;
  interactionTxHash: string;
  attestationUID: string;
  rating: number;
  comment: string;
}

/** Two-tier verified block: EF gate (Tier 1) + verified public vouches (Tier 2). */
export interface VerifiedBlock {
  efApproved: boolean;
  efAttester?: string;
  efAttestationUID?: string;
  publicVouches: number;
  rankedAttesters: PublicVouch[];
}

/** Filters accepted by the browse route (GET /descriptors). */
export interface BrowseFilters {
  chainId?: number;
  contract?: string;
  selector?: string;
  kind?: string;
  intent?: string;
  entityName?: string;
  contractName?: string;
  functionName?: string;
  owner?: string;
  sourcePath?: string;
  source?: string;
  eip712PrimaryType?: string;
}
