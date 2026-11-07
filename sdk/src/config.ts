// EAS chain config profiles for @klarity/sdk.
//
// EAS contract addresses are the canonical deployments sourced from
// @ethereum-attestation-service/eas-contracts. Schema UIDs are only filled in
// where the schema is actually registered on that chain; an unregistered UID is
// left '' and MUST NEVER be fabricated (the attest/verify paths treat '' as
// "not available on this chain").

export interface EasProfile {
  chainId: number;
  easContract: string;
  /** ERC-8176 canonical EF schema UID. '' if unregistered on this chain. */
  efSchemaUID: string;
  /** Extended public (interaction-proven) schema UID. '' if unregistered on this chain. */
  publicSchemaUID: string;
  /** Optional default RPC URL for read-side verification. */
  rpcUrl?: string;
}

/** ERC-8176 canonical EF schema — exactly this string, never altered. */
export const EF_SCHEMA_STRING = 'bytes32 descriptorHash';

/** Extended public (Tier 2) schema — exactly these 6 fields, never altered. */
export const PUBLIC_SCHEMA_STRING =
  'bytes32 descriptorHash,address contract,uint256 chainId,bytes32 interactionTxHash,uint8 rating,string comment';

/** Ethereum mainnet — the default. EF schema UID is pinned (ERC-8176 registration). */
export const MAINNET: EasProfile = {
  chainId: 1,
  easContract: '0xA1207F3BBa224E2c9c3c6D5aF63D0eb1582Ce587',
  efSchemaUID: '0xe023eef113c1670774801c34b377fdf612dd8a4d2fa92fe382e15bd91fafb5c2',
  // Not yet registered on mainnet — left empty, never fabricated.
  publicSchemaUID: '',
};

/** Sepolia testnet EAS deployment. Neither schema registered here yet. */
export const SEPOLIA: EasProfile = {
  chainId: 11155111,
  easContract: '0xC2679fBD37d54388Ce493F1DB75320D236e1815e',
  efSchemaUID: '',
  publicSchemaUID: '',
};

/** Base Sepolia testnet EAS deployment. Neither schema registered here yet. */
export const BASE_SEPOLIA: EasProfile = {
  chainId: 84532,
  easContract: '0x4200000000000000000000000000000000000021',
  efSchemaUID: '',
  publicSchemaUID: '',
};

/** All built-in profiles, keyed by chainId for convenient lookup. */
export const PROFILES: Record<number, EasProfile> = {
  [MAINNET.chainId]: MAINNET,
  [SEPOLIA.chainId]: SEPOLIA,
  [BASE_SEPOLIA.chainId]: BASE_SEPOLIA,
};
