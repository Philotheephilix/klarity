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
