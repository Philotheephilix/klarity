import { describe, it, expect } from 'vitest';
import { openDb } from '../src/db.js';

describe('openDb', () => {
  it('sync cursor round-trips: null before set, value after', () => {
    const db = openDb(':memory:');
    expect(db.getSyncCursor()).toBeNull();
    db.setSyncCursor('abc123');
    expect(db.getSyncCursor()).toBe('abc123');
    db.setSyncCursor('def456');
    expect(db.getSyncCursor()).toBe('def456');
  });

  it('markNonceUsed on same (signer,nonce) twice is detected, not fresh', () => {
    const db = openDb(':memory:');
    expect(db.isNonceUsed('0xsigner', '1')).toBe(false);
    expect(db.markNonceUsed('0xsigner', '1')).toBe(true);
    expect(db.isNonceUsed('0xsigner', '1')).toBe(true);
    // second mark of same pair must NOT succeed as fresh
    expect(db.markNonceUsed('0xsigner', '1')).toBe(false);
    // different nonce for same signer is independent
    expect(db.isNonceUsed('0xsigner', '2')).toBe(false);
    // different signer, same nonce is independent
    expect(db.isNonceUsed('0xother', '1')).toBe(false);
  });

  it('getHash returns stored value and null for unknown path', () => {
    const db = openDb(':memory:');
    expect(db.getHash('calldata/a.json')).toBeNull();
    db.setHash('calldata/a.json', '0xdeadbeef');
    expect(db.getHash('calldata/a.json')).toBe('0xdeadbeef');
    // overwrite updates in place
    db.setHash('calldata/a.json', '0xfeedface');
    expect(db.getHash('calldata/a.json')).toBe('0xfeedface');
    expect(db.getHash('calldata/b.json')).toBeNull();
  });

  it('delivery dedupe works', () => {
    const db = openDb(':memory:');
    expect(db.wasDelivery('d1')).toBe(false);
    db.markDelivery('d1');
    expect(db.wasDelivery('d1')).toBe(true);
    expect(db.wasDelivery('d2')).toBe(false);
    // marking same delivery again stays idempotent (still seen)
    db.markDelivery('d1');
    expect(db.wasDelivery('d1')).toBe(true);
  });
});
