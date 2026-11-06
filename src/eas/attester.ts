// Server-side EF attestation seam.
//
// The write route needs only the `EfAttester` interface: given a descriptor's
// content hash, produce an EAS attestation and return its UID + attester
// address. The route never touches eas-sdk or a key — a configured attester is
// injected into `ServerDeps`, and tests inject a fake.
//
// The production factory (`makeEfAttester`) wraps an already-constructed,
// attest-capable object (the SDK's `KlarityAttester`, built by the caller that
// has `@klarity/sdk` resolvable). This keeps eas-sdk out of the server's import
// graph here — the SDK packaging/resolution question is deferred to T9 — while
// still reusing the SDK's single `SchemaEncoder`+`EAS.attest` path rather than
// duplicating it. The signer lives on the injected attester; it is never read
// from a key file by this module.

/** What the write route depends on: attest a content hash, get a UID back. */
export interface EfAttester {
  attest(descriptorHash: string): Promise<{ uid: string; attester: string }>;
}

/**
 * The minimal shape the factory needs from an SDK attester. `KlarityAttester`
 * satisfies it (`attestDescriptor(descriptor) => Promise<uid>` + `profile`),
 * but we accept this narrow structural type so the server need not import the
 * SDK's concrete class (and thereby eas-sdk) at this layer.
 */
export interface SdkAttestLike {
  /** Signs + submits an EF attestation for the hash, resolving to the UID. */
  attestByHash(descriptorHash: string): Promise<string>;
  /** The attester address that will appear on-chain (the injected signer). */
  readonly attesterAddress: string;
}

export interface MakeEfAttesterOptions {
  /** A pre-built, signer-bound SDK attester. Reuse — do not duplicate encode. */
  sdk: SdkAttestLike;
}

/**
 * Wrap an injected SDK attester as the route-facing `EfAttester`. The signer is
 * already bound inside `sdk`; this module reads no key and holds no secret.
 */
export function makeEfAttester(opts: MakeEfAttesterOptions): EfAttester {
  const { sdk } = opts;
  return {
    async attest(descriptorHash: string): Promise<{ uid: string; attester: string }> {
      const uid = await sdk.attestByHash(descriptorHash);
      return { uid, attester: sdk.attesterAddress };
    },
  };
}
