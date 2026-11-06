import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { SEPOLIA, PROFILES } from '@klarity/sdk';
import {
  getApiBaseUrl,
  profileForChain,
  withPublicSchemaUID,
} from '../src/config.js';

describe('getApiBaseUrl', () => {
  it('defaults to the local Klarity server', () => {
    expect(getApiBaseUrl()).toBe('http://127.0.0.1:3000');
  });
});

describe('profileForChain', () => {
  it('returns the Sepolia profile for its chain id', () => {
    expect(profileForChain(11155111)).toBe(SEPOLIA);
    expect(profileForChain(11155111)).toBe(PROFILES[11155111]);
  });

  it('returns a known profile for a mapped chain id', () => {
    expect(profileForChain(1)).toBe(PROFILES[1]);
  });

  it('falls back to Sepolia for an unknown chain id', () => {
    expect(profileForChain(999999)).toBe(SEPOLIA);
  });
});

describe('default Sepolia profile', () => {
  it('has an empty publicSchemaUID until a human registers the schema', () => {
    expect(SEPOLIA.publicSchemaUID).toBe('');
  });
});

describe('withPublicSchemaUID', () => {
  const uid = '0x' + 'ab'.repeat(32);

  it('returns a new profile with publicSchemaUID set and all other fields unchanged', () => {
    const injected = withPublicSchemaUID(SEPOLIA, uid);
    expect(injected.publicSchemaUID).toBe(uid);
    expect(injected.chainId).toBe(SEPOLIA.chainId);
    expect(injected.easContract).toBe(SEPOLIA.easContract);
    expect(injected.efSchemaUID).toBe(SEPOLIA.efSchemaUID);
    expect(injected.rpcUrl).toBe(SEPOLIA.rpcUrl);
  });

  it('does not mutate the input profile', () => {
    withPublicSchemaUID(SEPOLIA, uid);
    expect(SEPOLIA.publicSchemaUID).toBe('');
  });

  it('returns a distinct object (not the same reference)', () => {
    const injected = withPublicSchemaUID(SEPOLIA, uid);
    expect(injected).not.toBe(SEPOLIA);
  });
});

describe('snap/README.md', () => {
  const readme = readFileSync(
    fileURLToPath(new URL('../README.md', import.meta.url)),
    'utf8',
  );

  it('contains no emoji', () => {
    const emoji =
      /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;
    expect(emoji.test(readme)).toBe(false);
  });

  it('documents the human-gated Sepolia schema registration step', () => {
    expect(readme).toContain('register the public-tier EAS schema');
    expect(readme).toContain('refuse to submit');
  });
});
