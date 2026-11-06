// DO NOT RUN — live on-chain write, human-only; prints the UID the human pastes into the EAS profile.
//
// Registers the extended 6-field public (Tier 2) EAS schema on Sepolia and
// prints the resulting schema UID. A human runs this out-of-band with the key
// and RPC injected via the environment; the CI/agent paths only ever IMPORT it
// (the live main() is gated behind the entrypoint guard below, so importing
// this module performs NO network call and NO registration).
//
// Human run (example):
//   node --env-file=.env --experimental-strip-types \
//     sdk/scripts/register-public-schema.ts
// Required env vars (read via process.env ONLY — this file never opens .env):
//   SEPOLIA_RPC_URL   — a Sepolia JSON-RPC endpoint
//   ARKIV_PRIVATE_KEY — the funded signer's private key
// The Sepolia SchemaRegistry address is a canonical PUBLIC constant (below),
// not a secret and not a schema UID.

import {
  SchemaRegistry,
  ZERO_ADDRESS,
} from '@ethereum-attestation-service/eas-sdk';
import { Wallet, JsonRpcProvider } from 'ethers';
import { pathToFileURL } from 'node:url';
import { PUBLIC_SCHEMA_STRING } from '../src/config.js';

/**
 * Canonical EAS SchemaRegistry contract on Sepolia. Public address (not a
 * secret, not the gated publicSchemaUID). Source: EAS Sepolia deployment.
 */
export const SEPOLIA_SCHEMA_REGISTRY_ADDRESS =
  '0x0a7E2Ff54e76B8E6659aedc9103FB21c038050D0';

/** The minimal SchemaRegistry surface this script depends on. */
interface SchemaRegistryLike {
  register(args: {
    schema: string;
    resolverAddress: string;
    revocable: boolean;
  }): Promise<{ wait(): Promise<string> }> | { wait(): Promise<string> };
}

/**
 * Register the extended 6-field public schema and return the new schema UID.
 *
 * By default this constructs a real SchemaRegistry connected to an ethers
 * wallet from the supplied opts — a LIVE on-chain write. Tests inject a fake
 * `registry` to exercise the logic with no network access.
 */
export async function registerPublicSchema(opts: {
  rpcUrl: string;
  privateKey: string;
  registryAddress: string;
  registry?: SchemaRegistryLike;
}): Promise<string> {
  const registry =
    opts.registry ??
    new SchemaRegistry(opts.registryAddress).connect(
      new Wallet(opts.privateKey, new JsonRpcProvider(opts.rpcUrl)),
    );

  const tx = await registry.register({
    schema: PUBLIC_SCHEMA_STRING,
    resolverAddress: ZERO_ADDRESS,
    revocable: true,
  });

  return tx.wait();
}

async function main(): Promise<void> {
  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  const privateKey = process.env.ARKIV_PRIVATE_KEY;
  const registryAddress =
    process.env.SEPOLIA_SCHEMA_REGISTRY_ADDRESS ??
    SEPOLIA_SCHEMA_REGISTRY_ADDRESS;

  if (!rpcUrl) {
    throw new Error('SEPOLIA_RPC_URL is not set');
  }
  if (!privateKey) {
    throw new Error('ARKIV_PRIVATE_KEY is not set');
  }

  const uid = await registerPublicSchema({ rpcUrl, privateKey, registryAddress });
  // The one human-facing output: the UID to paste into the EAS profile config.
  console.log(uid);
}

// Entrypoint guard: run main() only when this module is the process entrypoint
// (i.e. `node .../register-public-schema.ts`). When imported (e.g. by a test),
// import.meta.url will NOT equal the entrypoint URL, so main() never runs and
// no network call / registration occurs on import.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
