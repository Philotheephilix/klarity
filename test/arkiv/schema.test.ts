import { describe, it, expect } from 'vitest';
import { isArkivValue } from '@arkiv-network/sdk';
import {
  ClearSignDescriptor,
  SCHEMA_NAMESPACE,
  INDEXED_ATTRIBUTES,
  toValues,
} from '../../src/arkiv/schema.js';
import { descriptorHash } from '../../src/hash.js';
import { OPTIONAL_COLUMNS } from '../../src/arkiv/client.js';
import type { EntityRecord } from '../../src/normalize/types.js';

const calldataRec: EntityRecord = {
  chainId: 1,
  contract: '0xd01607c3c5ecaba394d8be377a08590149325722',
  selector: '0x474cf53d',
  functionName: 'depositETH',
  functionSignature: 'depositETH(address,address,uint16)',
  kind: 'calldata',
  intent: 'Supply',
  entityName: 'aave',
  contractName: 'WrappedTokenGatewayV3',
  owner: 'Aave DAO',
  sourcePath: 'registry/aave/calldata-WrappedTokenGatewayV3.json',
  schemaVersion: 'https://schemas.example/erc7730-v1',
  formatBlock: { intent: 'Supply', fields: [] },
};

const eip712Rec: EntityRecord = {
  chainId: 1,
  contract: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  selector: '0x8b73c3c6',
  functionName: 'Permit',
  functionSignature: 'Permit',
  kind: 'eip712',
  intent: 'Approve',
  entityName: 'dai',
  contractName: 'Dai',
  owner: 'MakerDAO',
  sourcePath: 'registry/dai/eip712-Permit.json',
  eip712PrimaryType: 'Permit',
  schemaVersion: 'https://schemas.example/erc7730-v1',
  formatBlock: { intent: 'Approve', fields: [] },
};

const CONTENT_HASH =
  '0x1111111111111111111111111111111111111111111111111111111111111111';
const AUTHORIZED_BY = '0x00000000000000000000000000000000000000ab';

describe('ClearSignDescriptor schema', () => {
  it('is defined under the exact registry namespace', () => {
    expect(SCHEMA_NAMESPACE).toBe('clear-signing-erc7730');
    expect(ClearSignDescriptor.name).toBe('clear-signing-erc7730');
  });

  it('has the exact indexed (queryable) attribute set per schema.md', () => {
    // Every column schema.md marks indexed must be filterable. `contentHash`
    // and `schemaVersion` are read-back only, so they are NOT indexed.
    const expected = [
      'chainId',
      'contract',
      'selector',
      'functionName',
      'kind',
      'intent',
      'entityName',
      'contractName',
      'owner',
      'sourcePath',
      'authorizedBy',
      'source',
      'eip712PrimaryType',
      'attestationUID',
      'attester',
    ].sort();
    expect([...INDEXED_ATTRIBUTES].sort()).toEqual(expected);

    const cols = ClearSignDescriptor.columns;
    for (const name of INDEXED_ATTRIBUTES) {
      expect(cols[name]?.isIndexed, `${name} must be indexed`).toBe(true);
    }
    // contentHash + schemaVersion present but not indexed.
    expect(cols.contentHash?.isIndexed).toBe(false);
    expect(cols.schemaVersion?.isIndexed).toBe(false);
  });

  it('declares authorizedBy and eip712PrimaryType optional', () => {
    const cols = ClearSignDescriptor.columns;
    expect(cols.authorizedBy?.isOptional).toBe(true);
    expect(cols.eip712PrimaryType?.isOptional).toBe(true);
  });

  it('has non-indexed body/bodyHash and no functionSignature column', () => {
    const cols = ClearSignDescriptor.columns;
    expect(cols.body?.isIndexed).toBe(false);
    expect(cols.bodyHash?.isIndexed).toBe(false);
    expect(cols.functionSignature).toBeUndefined();
  });

  it('declares functionName optional (omitted when over the str cap)', () => {
    const cols = ClearSignDescriptor.columns;
    expect(cols.functionName?.isOptional).toBe(true);
  });
});

describe('toValues mapping helper', () => {
  it('wraps every value as an Arkiv value, never a bare primitive', () => {
    const values = toValues(calldataRec, {
      source: 'github-sync',
      contentHash: CONTENT_HASH,
    });
    for (const [name, v] of Object.entries(values)) {
      expect(isArkivValue(v), `${name} must be an Arkiv value, got ${typeof v}`).toBe(true);
      expect(typeof v).not.toBe('number');
      expect(typeof v).not.toBe('string');
    }
  });

  it('maps chainId as u64, contract/selector/contentHash correctly', () => {
    const values = toValues(calldataRec, {
      source: 'github-sync',
      contentHash: CONTENT_HASH,
    });
    expect(values.chainId).toMatchObject({ type: 'u64', value: 1n });
    expect(values.contract).toMatchObject({ type: 'addr' });
    // selector stored as queryable str hex (bytes are not indexable in the SDK)
    expect(values.selector).toMatchObject({ type: 'str', value: '0x474cf53d' });
    expect(values.contentHash).toMatchObject({ type: 'bytes', value: CONTENT_HASH });
    expect(values.source).toMatchObject({ type: 'str', value: 'github-sync' });
  });

  it('normalizes the contract address (case-insensitive addr equality)', () => {
    const upper = { ...calldataRec, contract: '0xD01607C3C5ECABA394D8BE377A08590149325722' };
    const lower = toValues(calldataRec, { source: 'github-sync', contentHash: CONTENT_HASH });
    const fromUpper = toValues(upper, { source: 'github-sync', contentHash: CONTENT_HASH });
    // The SDK's addr() stores the EIP-55 checksummed form; addresses compare
    // case-insensitively on-chain, so upper/lower inputs produce the same value.
    expect((fromUpper.contract as { type: string; value: string }).type).toBe('addr');
    expect((fromUpper.contract as { value: string }).value.toLowerCase()).toBe(
      (lower.contract as { value: string }).value.toLowerCase(),
    );
    expect((fromUpper.contract as { value: string }).value.toLowerCase()).toBe(
      '0xd01607c3c5ecaba394d8be377a08590149325722',
    );
  });

  it('omits optional authorizedBy when not supplied', () => {
    const values = toValues(calldataRec, { source: 'github-sync', contentHash: CONTENT_HASH });
    expect(values.authorizedBy).toBeUndefined();
  });

  it('includes authorizedBy (addr) when supplied', () => {
    const values = toValues(calldataRec, {
      source: 'authorized-write',
      authorizedBy: AUTHORIZED_BY,
      contentHash: CONTENT_HASH,
    });
    expect(values.authorizedBy).toMatchObject({ type: 'addr' });
    expect(isArkivValue(values.authorizedBy)).toBe(true);
  });

  it('includes eip712PrimaryType for eip712 records and omits it for calldata', () => {
    const e = toValues(eip712Rec, { source: 'github-sync', contentHash: CONTENT_HASH });
    expect(e.eip712PrimaryType).toMatchObject({ type: 'str', value: 'Permit' });
    expect(e.kind).toMatchObject({ type: 'str', value: 'eip712' });

    const c = toValues(calldataRec, { source: 'github-sync', contentHash: CONTENT_HASH });
    expect(c.eip712PrimaryType).toBeUndefined();
  });

  it('emits body (bytes) and bodyHash (str = descriptorHash of formatBlock)', () => {
    const values = toValues(calldataRec, { source: 'github-sync', contentHash: CONTENT_HASH });
    expect(values.body).toMatchObject({ type: 'bytes' });
    expect(values.bodyHash).toMatchObject({
      type: 'str',
      value: descriptorHash(calldataRec.formatBlock),
    });
  });

  it('omits functionName when it exceeds the 128-byte str cap, still emits body/selector', () => {
    const big: EntityRecord = { ...calldataRec, functionName: 'a'.repeat(200) };
    const values = toValues(big, { source: 'github-sync', contentHash: CONTENT_HASH });
    expect(values.functionName).toBeUndefined();
    expect(values.body).toMatchObject({ type: 'bytes' });
    expect(values.selector).toMatchObject({ type: 'str', value: '0x474cf53d' });
    expect(values.bodyHash).toMatchObject({
      type: 'str',
      value: descriptorHash(big.formatBlock),
    });
  });

  it('omits eip712PrimaryType when it exceeds the 128-byte str cap, still emits body', () => {
    const big: EntityRecord = { ...eip712Rec, eip712PrimaryType: 'a'.repeat(300) };
    const values = toValues(big, { source: 'github-sync', contentHash: CONTENT_HASH });
    expect(values.eip712PrimaryType).toBeUndefined();
    expect(values.body).toMatchObject({ type: 'bytes' });
  });

  // Regression guard: every column toValues can omit for an over-cap record must be
  // in OPTIONAL_COLUMNS, or a patch on re-sync leaves the stale indexed value instead
  // of clearing it (the unset list is built by filtering OPTIONAL_COLUMNS on undefined).
  it('lists every omittable indexed field in client OPTIONAL_COLUMNS', () => {
    const overCap: EntityRecord = {
      ...eip712Rec,
      functionName: 'a'.repeat(200),
      eip712PrimaryType: 'a'.repeat(300),
    };
    const values = toValues(overCap, { source: 'github-sync', contentHash: CONTENT_HASH });
    expect(values.functionName).toBeUndefined();
    expect(values.eip712PrimaryType).toBeUndefined();
    expect(OPTIONAL_COLUMNS).toContain('functionName');
    expect(OPTIONAL_COLUMNS).toContain('eip712PrimaryType');
  });
});

const VALID_UID = '0x' + 'ab'.repeat(32);
const EF_ATTESTER = '0x00000000000000000000000000000000000000ef';

describe('toValues attestation columns (EF gate)', () => {
  it('includes attestationUID (str) and attester (addr) when both supplied and the UID is well-formed', () => {
    const values = toValues(calldataRec, {
      source: 'authorized-write',
      contentHash: CONTENT_HASH,
      attestationUID: VALID_UID,
      attester: EF_ATTESTER,
    });
    expect(values.attestationUID).toMatchObject({ type: 'str', value: VALID_UID });
    expect(values.attester).toMatchObject({ type: 'addr' });
    expect(isArkivValue(values.attestationUID)).toBe(true);
    expect(isArkivValue(values.attester)).toBe(true);
  });

  it('omits both attestation columns when no attestation is supplied', () => {
    const values = toValues(calldataRec, { source: 'github-sync', contentHash: CONTENT_HASH });
    expect(values.attestationUID).toBeUndefined();
    expect(values.attester).toBeUndefined();
  });

  it('omits a malformed attestationUID (not 0x + 64 hex) and its attester', () => {
    const notHex = toValues(calldataRec, {
      source: 'authorized-write',
      contentHash: CONTENT_HASH,
      attestationUID: '0xdeadbeef',
      attester: EF_ATTESTER,
    });
    expect(notHex.attestationUID).toBeUndefined();
    expect(notHex.attester).toBeUndefined();
  });

  it('lists attestationUID and attester in client OPTIONAL_COLUMNS (cleared on re-sync)', () => {
    expect(OPTIONAL_COLUMNS).toContain('attestationUID');
    expect(OPTIONAL_COLUMNS).toContain('attester');
  });

  it('declares attestationUID and attester indexed + optional', () => {
    const cols = ClearSignDescriptor.columns;
    expect(cols.attestationUID?.isIndexed).toBe(true);
    expect(cols.attestationUID?.isOptional).toBe(true);
    expect(cols.attester?.isIndexed).toBe(true);
    expect(cols.attester?.isOptional).toBe(true);
    expect(INDEXED_ATTRIBUTES).toContain('attestationUID');
    expect(INDEXED_ATTRIBUTES).toContain('attester');
  });
});
