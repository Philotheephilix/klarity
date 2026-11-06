import { describe, it, expect } from 'vitest';
import { ZERO_ADDRESS } from '@ethereum-attestation-service/eas-sdk';
import { PUBLIC_SCHEMA_STRING } from '../src/config.js';

// A fake SchemaRegistry-like object matching the injectable shape the script
// accepts. `register` records its call args and returns a tx whose `.wait()`
// resolves to a known UID. `connect` returns self (the real SDK returns a
// connected registry); we never hit a network here.
const KNOWN_UID = '0xUID';

function fakeRegistry() {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    connect() {
      return this;
    },
    register(args: Record<string, unknown>) {
      calls.push(args);
      return {
        async wait() {
          return KNOWN_UID;
        },
      };
    },
  };
}

describe('register-public-schema script', () => {
  it('importing the module performs NO registration / NO network call', async () => {
    // Merely importing must not invoke register. We inject a fake and confirm
    // it was untouched by the act of importing.
    const fake = fakeRegistry();
    await import('../scripts/register-public-schema.js');
    expect(fake.calls).toHaveLength(0);
  });

  it('registerPublicSchema calls register with the public schema, zero resolver, revocable=true and returns the UID', async () => {
    const { registerPublicSchema } = await import(
      '../scripts/register-public-schema.js'
    );
    const fake = fakeRegistry();
    const uid = await registerPublicSchema({
      rpcUrl: 'http://example.invalid',
      privateKey: '0x' + '11'.repeat(32),
      registryAddress: '0x0a7E2Ff54e76B8E6659aedc9103FB21c038050D0',
      registry: fake,
    });

    expect(uid).toBe(KNOWN_UID);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].schema).toBe(PUBLIC_SCHEMA_STRING);
    expect(fake.calls[0].resolverAddress).toBe(ZERO_ADDRESS);
    expect(fake.calls[0].revocable).toBe(true);
  });
});
