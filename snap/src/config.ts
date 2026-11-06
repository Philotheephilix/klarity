/**
 * Snap-side configuration helpers.
 *
 * The Snap is a CLIENT of the existing Klarity TypeScript server. These helpers
 * resolve where that server lives and which EAS profile applies to a chain.
 */
import { PROFILES, SEPOLIA, type EasProfile } from '@klarity/sdk';

/** Default base URL of the local Klarity server. */
const DEFAULT_API_BASE_URL = 'http://127.0.0.1:3000';

/**
 * Resolve the Klarity API base URL.
 *
 * Defaults to the local server. This is the documented override hook: a later
 * task can swap this for a Snap-state/env read without touching callers.
 */
export function getApiBaseUrl(): string {
  return DEFAULT_API_BASE_URL;
}

/**
 * Resolve the EAS profile for a chain id, defaulting to Sepolia when the chain
 * is not one of the SDK's built-in profiles.
 */
export function profileForChain(chainId: number): EasProfile {
  return PROFILES[chainId] ?? SEPOLIA;
}

/**
 * Inject a human-provided, human-approved public-tier schema UID into a profile.
 *
 * Returns a NEW profile with `publicSchemaUID` set to `uid` and every other
 * field unchanged; the input profile is never mutated. This is the runtime
 * injection hook for a Sepolia UID that a human registers out of band — the
 * code never hard-codes or fabricates a UID.
 */
export function withPublicSchemaUID(profile: EasProfile, uid: string): EasProfile {
  return { ...profile, publicSchemaUID: uid };
}
