import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { knownEntityNames, SEED_ENTITIES } from '../lib/entities';

const REQUIRED = ['aave', 'celo', 'dai', 'okx', 'safe', '1inch'];

describe('SEED_ENTITIES', () => {
  it('includes every required registry org', () => {
    const names = SEED_ENTITIES.map((e) => e.entityName);
    for (const req of REQUIRED) {
      expect(names).toContain(req);
    }
  });

  it('has a non-empty lowercase entityName and a non-empty displayName for every entry', () => {
    for (const entity of SEED_ENTITIES) {
      expect(entity.entityName.length).toBeGreaterThan(0);
      expect(entity.entityName).toBe(entity.entityName.toLowerCase());
      expect(entity.displayName.trim().length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate entityName', () => {
    const names = SEED_ENTITIES.map((e) => e.entityName);
    expect(new Set(names).size).toBe(names.length);
  });

  it('knownEntityNames() returns exactly the seed entity names', () => {
    expect(knownEntityNames()).toEqual(SEED_ENTITIES.map((e) => e.entityName));
  });

  it('the module source contains no emoji', () => {
    const src = readFileSync(resolve(__dirname, '../lib/entities.ts'), 'utf8');
    const emoji =
      /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F1FF}]/u;
    expect(src).not.toMatch(emoji);
  });
});
