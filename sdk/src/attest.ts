// EAS attestation for @klarity/sdk — Tier 1 (EF gate, ERC-8176).
//
// Tier 1 is the canonical ERC-8176 gate: an attestation under the `bytes32
// descriptorHash` schema, signed by a trusted (EF) wallet. `verifyEf` is pure
// filtering logic over a candidate attestation list, so it is fully testable
// without a chain — the candidate source is injected via `readAttestations`.
//
// Tier 2 (public interaction-proven vouches) is added to this same class in a
// later task; the shared `readAttestations` injection serves both tiers.

import { EAS, SchemaEncoder, ZERO_ADDRESS, ZERO_BYTES32 } from '@ethereum-attestation-service/eas-sdk';
import type { Attestation } from '@ethereum-attestation-service/eas-sdk';
import { descriptorHash } from './hash.js';
import { EF_SCHEMA_STRING, type EasProfile } from './config.js';

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
}
