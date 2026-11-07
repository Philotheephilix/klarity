import { describe, it, expect, vi } from 'vitest';
import { ZERO_ADDRESS } from '@ethereum-attestation-service/eas-sdk';
import { PUBLIC_SCHEMA_STRING } from '../src/config.js';

const KNOWN_UID = '0xUID';

// --- Import-safety spies -----------------------------------------------------
// Spy on the REAL side-effecting dependencies the script would touch on a live
// run: the SchemaRegistry constructor + its register(), and the ethers Wallet /
// JsonRpcProvider constructors. If importing the module ever constructed any of
// these (or called register) at import time, these spies would record it. This
// is what makes the import-safety assertion non-vacuous: it watches the exact
// objects the module uses, not a local fake that is never handed to it.
// vi.mock factories are hoisted to the top of the file, so the spies they
// reference must be created with vi.hoisted (also hoisted) to exist in time.
const { registerSpy, schemaRegistryCtor, walletCtor, providerCtor } =
  vi.hoisted(() => {
    const registerSpy = vi.fn();
    return {
      registerSpy,
      schemaRegistryCtor: vi.fn(() => ({
        connect() {
          return this;
        },
        register: registerSpy,
      })),
      walletCtor: vi.fn(),
      providerCtor: vi.fn(),
    };
  });

vi.mock('@ethereum-attestation-service/eas-sdk', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@ethereum-attestation-service/eas-sdk')>();
  return {
    ...actual,
    SchemaRegistry: schemaRegistryCtor,
  };
});

vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ethers')>();
  return {
    ...actual,
    Wallet: walletCtor,
    JsonRpcProvider: providerCtor,
  };
});

describe('register-public-schema script', () => {
  it('importing the module performs NO registration / NO network call', async () => {
    // Importing must not construct a SchemaRegistry/Wallet/JsonRpcProvider nor
    // call register. These spies watch the module's real dependencies, so a
    // regression that moved a live call to module scope would be caught here.
    await import('../scripts/register-public-schema.js');
    expect(schemaRegistryCtor).not.toHaveBeenCalled();
    expect(registerSpy).not.toHaveBeenCalled();
    expect(walletCtor).not.toHaveBeenCalled();
    expect(providerCtor).not.toHaveBeenCalled();
  });

  it('registerPublicSchema calls register with the public schema, zero resolver, revocable=true and returns the UID', async () => {
    const { registerPublicSchema } = await import(
      '../scripts/register-public-schema.js'
    );

    // A fake SchemaRegistry-like object matching the injectable shape. `register`
    // records its args and returns a tx whose `.wait()` yields a known UID.
    const calls: Array<Record<string, unknown>> = [];
    const fake = {
      register(args: Record<string, unknown>) {
        calls.push(args);
        return Promise.resolve({
          async wait() {
            return KNOWN_UID;
          },
        });
      },
    };

    const uid = await registerPublicSchema({
      rpcUrl: 'http://example.invalid',
      privateKey: '0x' + '11'.repeat(32),
      registryAddress: '0x0a7E2Ff54e76B8E6659aedc9103FB21c038050D0',
      registry: fake,
    });

    expect(uid).toBe(KNOWN_UID);
    expect(calls).toHaveLength(1);
    expect(calls[0].schema).toBe(PUBLIC_SCHEMA_STRING);
    expect(calls[0].resolverAddress).toBe(ZERO_ADDRESS);
    expect(calls[0].revocable).toBe(true);

    // The injected path must not touch the real network dependencies either.
    expect(schemaRegistryCtor).not.toHaveBeenCalled();
    expect(walletCtor).not.toHaveBeenCalled();
    expect(providerCtor).not.toHaveBeenCalled();
  });
});
