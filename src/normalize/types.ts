/**
 * A single flat, self-contained clear-signing entity: one per
 * (deployment × format key). Produced by the normalizer; the writer layer
 * later adds `authorizedBy` / `source` / `contentHash`.
 */
export interface EntityRecord {
  /** EVM chain id of the deployment. */
  chainId: number;
  /** Contract address, lowercased. */
  contract: string;
  /**
   * 4-byte selector as `0x` + 8 hex chars.
   * - calldata: keccak256(canonicalSignature)[0:4]
   * - eip712:   keccak256(primaryType type-encoding)[0:4] (typeHash prefix)
   */
  selector: string;
  /** Canonical function name (calldata) or primary type string (eip712). */
  functionName: string;
  /** Full signature / format key (calldata) or primary type string (eip712). */
  functionSignature: string;
  kind: 'calldata' | 'eip712';
  /** Human action from the format block's `intent`. */
  intent: string;
  /** Submitting org / registry dir, derived from sourcePath (e.g. "aave"). */
  entityName: string;
  /** Contract name (context.$id / metadata info legalName), or "" if absent. */
  contractName: string;
  /** Descriptor `metadata.owner`, or "". */
  owner: string;
  /** Source descriptor path, e.g. "registry/aave/calldata-...json". */
  sourcePath: string;
  /** EIP-712 primary type (eip712 kind only). */
  eip712PrimaryType?: string;
  /** `$schema` version the descriptor targets. */
  schemaVersion: string;
  /** The full, self-contained ERC-7730 format block (includes+refs resolved). */
  formatBlock: Record<string, unknown>;
}
