// EAS attestation for @klarity/sdk — two-tier trust model.
//
// Tier 1 (EF gate, ERC-8176): an attestation under the `bytes32 descriptorHash`
// schema, signed by a trusted (EF) wallet. `verifyEf` is pure filtering logic
// over a candidate attestation list, testable without a chain — the candidate
// source is injected via `readAttestations`.
//
// Tier 2 (public interaction-proven vouches): an attestation under the extended
// 4-field schema. A vouch counts ONLY if its `interactionTxHash` resolves to a
// mined tx with `to == contract` and `from == attester` — so a vouch cannot be
// forged by pointing at someone else's transaction. The same `readAttestations`
// injection serves both tiers.

import { EAS, SchemaEncoder, ZERO_ADDRESS, ZERO_BYTES32 } from '@ethereum-attestation-service/eas-sdk';
import type { Attestation } from '@ethereum-attestation-service/eas-sdk';
import { descriptorHash } from './hash.js';
import { EF_SCHEMA_STRING, PUBLIC_SCHEMA_STRING, type EasProfile } from './config.js';
import type { PublicVouch, VerifiedBlock } from './types.js';

/** A signer (writes) or provider (reads) accepted by the EAS SDK. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SignerOrProvider = any;

/**
 * Pulls candidate attestations for a `(schemaUID, descriptorHash)` pair. The
 * EAS contract has no "query by schema+data" read, so the caller supplies the
 * source — an EAS indexer/GraphQL query, or the single UID stored on the Arkiv
 * row. Tests inject a fixed list to exercise the filter logic chain-free.
 */
export type ReadAttestations = (
  schemaUID: string,
  descriptorHash: string,
) => Promise<Attestation[]>;

export interface KlarityAttesterOptions {
  profile: EasProfile;
  /** Needed only for write paths (attest*). Reads/verify work without it. */
  signerOrProvider?: SignerOrProvider;
  /** Candidate-attestation source for verify paths. */
  readAttestations?: ReadAttestations;
}

export interface VerifyEfOptions {
  /** Attesters whose EF attestations count as the gate (e.g. the EF wallet). */
  trustedAttesters: string[];
  /** Current unix time (seconds) for expiry checks; defaults to now. */
  now?: bigint;
}

export interface EfVerdict {
  efApproved: boolean;
  efAttester?: string;
  efAttestationUID?: string;
}

/** Minimal ethers provider surface needed to prove an interaction tx. */
export interface InteractionProvider {
  getTransaction(hash: string): Promise<{ to: string | null; from: string } | null>;
  getTransactionReceipt(hash: string): Promise<{ status?: number | null } | null>;
}

/** The 4 fields of the extended public (Tier 2) schema. */
export interface PublicData {
  descriptorHash: string;
  contract: string;
  chainId: number;
  interactionTxHash: string;
}

export interface InteractionClaim {
  contract: string;
  attester: string;
  interactionTxHash: string;
}

export interface VerifyPublicOptions {
  provider: InteractionProvider;
}

export interface VerifyDescriptorOptions {
  trustedAttesters: string[];
  provider: InteractionProvider;
  now?: bigint;
}

/** Encode the 4-field public-schema call data. */
export function encodePublicData(d: PublicData): string {
  const encoder = new SchemaEncoder(PUBLIC_SCHEMA_STRING);
  return encoder.encodeData([
    { name: 'descriptorHash', type: 'bytes32', value: d.descriptorHash },
    { name: 'contract', type: 'address', value: d.contract },
    { name: 'chainId', type: 'uint256', value: BigInt(d.chainId) },
    { name: 'interactionTxHash', type: 'bytes32', value: d.interactionTxHash },
  ]);
}

/** Decode the 4-field public-schema call data. */
export function decodePublicData(data: string): PublicData {
  const encoder = new SchemaEncoder(PUBLIC_SCHEMA_STRING);
  const items = encoder.decodeData(data);
  const byName: Record<string, unknown> = {};
  for (const i of items) byName[i.name] = i.value.value;
  return {
    descriptorHash: String(byName.descriptorHash),
    contract: String(byName.contract),
    chainId: Number(byName.chainId),
    interactionTxHash: String(byName.interactionTxHash),
  };
}

/** Encode a descriptor hash as EF-schema (`bytes32 descriptorHash`) call data. */
export function encodeEfData(hash: string): string {
  const encoder = new SchemaEncoder(EF_SCHEMA_STRING);
  return encoder.encodeData([{ name: 'descriptorHash', type: 'bytes32', value: hash }]);
}

/** Decode EF-schema call data back to the descriptor hash. */
export function decodeEfData(data: string): string {
  const encoder = new SchemaEncoder(EF_SCHEMA_STRING);
  const items = encoder.decodeData(data);
  const field = items.find((i) => i.name === 'descriptorHash');
  if (!field) throw new Error('decodeEfData: no descriptorHash field in data');
  return String(field.value.value);
}

/** Is the attestation currently valid (unrevoked and not expired)? */
function isLive(a: Attestation, now: bigint): boolean {
  if (a.revocationTime !== 0n) return false;
  if (a.expirationTime !== 0n && a.expirationTime <= now) return false;
  return true;
}

export class KlarityAttester {
  readonly profile: EasProfile;
  private readonly signerOrProvider?: SignerOrProvider;
  private readonly readAttestations?: ReadAttestations;

  constructor(opts: KlarityAttesterOptions) {
    this.profile = opts.profile;
    this.signerOrProvider = opts.signerOrProvider;
    this.readAttestations = opts.readAttestations;
  }

  /** The descriptor's canonical hash — the subject of every attestation. */
  private hashOf(descriptor: object): string {
    return descriptorHash(descriptor);
  }

  private eas(): EAS {
    if (!this.signerOrProvider) {
      throw new Error('KlarityAttester: a signerOrProvider is required for on-chain calls');
    }
    return new EAS(this.profile.easContract).connect(this.signerOrProvider);
  }

  /**
   * Attest a descriptor under the EF (ERC-8176) schema. Requires a signer and a
   * registered `efSchemaUID` on the profile's chain. Returns the attestation UID.
   */
  async attestDescriptor(descriptor: object): Promise<string> {
    if (!this.profile.efSchemaUID) {
      throw new Error(
        `KlarityAttester: no efSchemaUID registered for chainId ${this.profile.chainId}`,
      );
    }
    const data = encodeEfData(this.hashOf(descriptor));
    const tx = await this.eas().attest({
      schema: this.profile.efSchemaUID,
      data: {
        recipient: ZERO_ADDRESS,
        expirationTime: 0n,
        revocable: true,
        refUID: ZERO_BYTES32,
        data,
      },
    });
    return tx.wait();
  }

  /** Read one attestation by UID (requires a signer/provider). */
  async getEfAttestation(uid: string): Promise<Attestation> {
    return this.eas().getAttestation(uid);
  }

  /**
   * The EF gate: approved iff at least one candidate attestation is from a
   * trusted attester AND currently live (unrevoked, unexpired). Returns the
   * first qualifying attestation's attester + UID.
   */
  async verifyEf(descriptor: object, opts: VerifyEfOptions): Promise<EfVerdict> {
    if (!this.readAttestations) {
      throw new Error('KlarityAttester: readAttestations is required for verifyEf');
    }
    const now = opts.now ?? BigInt(Math.floor(Date.now() / 1000));
    const trusted = new Set(opts.trustedAttesters.map((a) => a.toLowerCase()));
    const hash = this.hashOf(descriptor);
    const candidates = await this.readAttestations(this.profile.efSchemaUID, hash);

    for (const a of candidates) {
      if (!trusted.has(a.attester.toLowerCase())) continue;
      if (!isLive(a, now)) continue;
      return { efApproved: true, efAttester: a.attester, efAttestationUID: a.uid };
    }
    return { efApproved: false };
  }

  // ─── Tier 2: public interaction-proven vouches ───────────────────────────

  /**
   * Attest a public vouch under the extended 4-field schema. Requires a signer
   * and a registered `publicSchemaUID`. Returns the attestation UID.
   */
  async attestPublic(descriptor: object, claim: InteractionClaim): Promise<string> {
    if (!this.profile.publicSchemaUID) {
      throw new Error(
        `KlarityAttester: no publicSchemaUID registered for chainId ${this.profile.chainId}`,
      );
    }
    const data = encodePublicData({
      descriptorHash: this.hashOf(descriptor),
      contract: claim.contract,
      chainId: this.profile.chainId,
      interactionTxHash: claim.interactionTxHash,
    });
    const tx = await this.eas().attest({
      schema: this.profile.publicSchemaUID,
      data: {
        recipient: ZERO_ADDRESS,
        expirationTime: 0n,
        revocable: true,
        refUID: ZERO_BYTES32,
        data,
      },
    });
    return tx.wait();
  }

  /**
   * Prove an interaction claim against the chain: the tx must be mined, with
   * `to == contract` and `from == attester`. This is what makes a public vouch
   * un-forgeable — pointing at someone else's tx (`from != attester`) or an
   * unrelated contract (`to != contract`) fails, as does an unmined tx.
   */
  async verifyInteraction(
    provider: InteractionProvider,
    claim: InteractionClaim,
  ): Promise<boolean> {
    const tx = await provider.getTransaction(claim.interactionTxHash);
    if (!tx) return false;
    const receipt = await provider.getTransactionReceipt(claim.interactionTxHash);
    if (!receipt) return false; // unmined
    if (receipt.status !== undefined && receipt.status !== null && receipt.status === 0) {
      return false; // reverted
    }
    if (!tx.to || tx.to.toLowerCase() !== claim.contract.toLowerCase()) return false;
    if (tx.from.toLowerCase() !== claim.attester.toLowerCase()) return false;
    return true;
  }

  /**
   * Gather public-schema attestations for the descriptor, keep only those whose
   * `interactionTxHash` passes `verifyInteraction` for that attestation's own
   * attester, and dedupe by attester. The count is the ranking signal.
   */
  async verifyPublic(
    descriptor: object,
    opts: VerifyPublicOptions,
  ): Promise<{ publicVouches: number; rankedAttesters: PublicVouch[] }> {
    if (!this.readAttestations) {
      throw new Error('KlarityAttester: readAttestations is required for verifyPublic');
    }
    if (!this.profile.publicSchemaUID) {
      return { publicVouches: 0, rankedAttesters: [] };
    }
    const hash = this.hashOf(descriptor);
    const candidates = await this.readAttestations(this.profile.publicSchemaUID, hash);

    const seen = new Set<string>();
    const ranked: PublicVouch[] = [];
    for (const a of candidates) {
      if (!isLive(a, BigInt(Math.floor(Date.now() / 1000)))) continue;
      const decoded = decodePublicData(a.data);
      const ok = await this.verifyInteraction(opts.provider, {
        contract: decoded.contract,
        attester: a.attester,
        interactionTxHash: decoded.interactionTxHash,
      });
      if (!ok) continue;
      const key = a.attester.toLowerCase();
      if (seen.has(key)) continue; // dedupe: one vouch per attester
      seen.add(key);
      ranked.push({
        attester: a.attester,
        interactionTxHash: decoded.interactionTxHash,
        attestationUID: a.uid,
      });
    }
    return { publicVouches: ranked.length, rankedAttesters: ranked };
  }

  /** Merge both tiers into the two-tier `VerifiedBlock`. */
  async verifyDescriptor(
    descriptor: object,
    opts: VerifyDescriptorOptions,
  ): Promise<VerifiedBlock> {
    const ef = await this.verifyEf(descriptor, {
      trustedAttesters: opts.trustedAttesters,
      now: opts.now,
    });
    const pub = await this.verifyPublic(descriptor, { provider: opts.provider });
    return {
      efApproved: ef.efApproved,
      efAttester: ef.efAttester,
      efAttestationUID: ef.efAttestationUID,
      publicVouches: pub.publicVouches,
      rankedAttesters: pub.rankedAttesters,
    };
  }
}
