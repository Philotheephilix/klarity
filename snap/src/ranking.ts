/**
 * Ranking vouch — claim construction + gated submission.
 *
 * After a clear-signed transaction is mined, the user may vouch that it did what
 * the clear-signing described. That produces a public-tier, interaction-proven
 * EAS vouch via `@klarity/sdk`. This module never reimplements hashing or
 * attestation: it shapes the claim and orchestrates the SDK's own
 * `verifyInteraction` / `attestPublic`.
 *
 * CRITICAL GATE: live vouch submission stays DISABLED until a human registers a
 * public-tier schema UID for the chain. While `profile.publicSchemaUID` is the
 * empty string, `submitVouch` refuses without ever calling `attestPublic` — no
 * live EAS write, no fabricated UID.
 */
import type {
  InteractionClaim,
  InteractionProvider,
  EasProfile,
  KlarityAttester,
} from '@klarity/sdk';

/**
 * Shape the three address/hash inputs into an `InteractionClaim`. Pass-through
 * casing: `verifyInteraction` lower-cases internally, so no normalization here.
 */
export function buildClaim(args: {
  contract: string;
  attester: string;
  interactionTxHash: string;
}): InteractionClaim {
  return {
    contract: args.contract,
    attester: args.attester,
    interactionTxHash: args.interactionTxHash,
  };
}

export interface SubmitVouchDeps {
  attester: KlarityAttester;
  provider: InteractionProvider;
  profile: EasProfile;
}

export interface SubmitVouchResult {
  submitted: boolean;
  uid?: string;
  reason?: string;
}

/**
 * Gate -> verify -> attest.
 *
 * 1. GATE FIRST: if the profile has no public schema registered, refuse without
 *    touching `attestPublic` (which would otherwise throw). This is the guard
 *    that keeps the feature dark while `publicSchemaUID` is empty.
 * 2. Verify the interaction is genuinely the attester's own mined tx to the
 *    contract. A forged or unmined claim is refused without attesting.
 * 3. Submit the public attestation and return its UID.
 */
export async function submitVouch(
  descriptor: object,
  claim: InteractionClaim,
  deps: SubmitVouchDeps,
): Promise<SubmitVouchResult> {
  if (deps.profile.publicSchemaUID === '') {
    return {
      submitted: false,
      reason: `public schema not registered on chainId ${deps.profile.chainId}`,
    };
  }

  const proven = await deps.attester.verifyInteraction(deps.provider, claim);
  if (!proven) {
    return { submitted: false, reason: 'interaction not proven' };
  }

  const uid = await deps.attester.attestPublic(descriptor, claim);
  return { submitted: true, uid };
}
