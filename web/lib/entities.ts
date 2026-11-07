export interface SeedEntity {
  entityName: string;
  displayName: string;
}

// Known ERC-7730 registry orgs. Each entityName is the lowercase registry
// directory name (registry/<entityName>/...), per deriveEntityName in
// src/normalize/normalize.ts. displayName is a human-facing label.
export const SEED_ENTITIES: SeedEntity[] = [
  { entityName: '1inch', displayName: '1inch' },
  { entityName: 'aave', displayName: 'Aave' },
  { entityName: 'celo', displayName: 'Celo' },
  { entityName: 'dai', displayName: 'Dai' },
  { entityName: 'okx', displayName: 'OKX' },
  { entityName: 'safe', displayName: 'Safe' },
];

export function knownEntityNames(): string[] {
  return SEED_ENTITIES.map((entity) => entity.entityName);
}
