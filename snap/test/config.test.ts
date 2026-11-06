import { describe, it, expect } from 'vitest';
import { SEPOLIA, PROFILES } from '@klarity/sdk';
import { getApiBaseUrl, profileForChain } from '../src/config.js';

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
