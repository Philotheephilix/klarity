import {
  createWalletClient,
  createPublicClient,
  NO_SALT,
  predictEntityKey,
  ExpirationTime,
} from '@arkiv-network/sdk';
import { and, eq } from '@arkiv-network/sdk/query';
import { u64, addr, str } from '@arkiv-network/sdk/schema';
import { rabdi } from '@arkiv-network/sdk/chains';
import { http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Config } from '../config.js';
import type { EntityRecord } from '../normalize/types.js';
import {
  ClearSignDescriptor,
  toValues,
  type WriteMeta,
} from './schema.js';

/** The identity a descriptor row is looked up and upserted by. */
export interface Identity {
  chainId: number;
  contract: string;
  /** 4-byte selector hex `0x…` (calldata selector or eip712 typeHash prefix). */
  selector: string;
}

export interface UpsertResult {
  entityKey: Hex;
  txHash: Hex;
  /** `true` if a new entity was created, `false` if an existing one was patched. */
  created: boolean;
}

/** Any wider filter the browse queries use (all keys are indexed columns). */
export type QueryFilter = Partial<{
  chainId: number;
  contract: string;
  selector: string;
  kind: string;
  intent: string;
  entityName: string;
  contractName: string;
  functionName: string;
  functionSignature: string;
  owner: string;
  sourcePath: string;
  source: string;
  eip712PrimaryType: string;
}>;

// Optional columns that a patch may need to clear when the new record omits them.
const OPTIONAL_COLUMNS = ['authorizedBy', 'eip712PrimaryType'] as const;

/**
 * Reads and writes `ClearSignDescriptor` entities on Arkiv (Rabdi testnet).
 *
 * Deterministic upsert: the on-chain entity key is derived by the engine from
 * `(owner, nonce, salt)` — NOT from the record's identity attributes — so a key
 * cannot be computed from `(chainId, contract, selector)` alone. Upsert instead
 * queries for the existing entity by its indexed identity (pinned to the service
 * wallet's `.createdBy`) and PATCHES it when found, otherwise CREATES a new one
 * with `NO_SALT` so the created key is predictable. Same identity => same entity
 * across re-syncs, no duplicates.
 *
 * Every read is pinned with `.createdBy(REGISTRY_WALLET)` — the impostor-entity
 * trust filter, where `REGISTRY_WALLET` is the service wallet address.
 */
export class ArkivClient {
  readonly registryWallet: Hex;
  // viem/Arkiv clients — typed loosely to avoid leaking the SDK's deep generic
  // client types across the module boundary. Reads (`select`/`getEntityNonce`)
  // live on the public client; writes on the wallet client.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly wallet: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly reader: any;
  private readonly chainId: number;

  constructor(config: Config) {
    const account = privateKeyToAccount(config.arkiv.privateKey as Hex);
    this.registryWallet = account.address;
    const accessKey = config.arkiv.accessKey;
    const chain = rabdi({ accessKey });
    this.chainId = chain.id;
    this.wallet = createWalletClient({
      account,
      chain,
      transport: http(config.arkiv.rpcUrl),
    });
    this.reader = createPublicClient({
      chain,
      transport: http(config.arkiv.rpcUrl),
    });
  }

  /** The select-query builder for an identity/filter, pinned to the registry wallet. */
  queryManyBuilder(filter: QueryFilter) {
    const predicates = buildPredicates(filter);
    return this.reader
      .select({
        $key: true,
        chainId: true,
        contract: true,
        selector: true,
        functionName: true,
        functionSignature: true,
        kind: true,
        intent: true,
        entityName: true,
        contractName: true,
        owner: true,
        sourcePath: true,
        authorizedBy: true,
        source: true,
        eip712PrimaryType: true,
        contentHash: true,
        schemaVersion: true,
      })
      .from(ClearSignDescriptor)
      .where(and(predicates))
      .createdBy(this.registryWallet);
  }

  /** All matching rows (pinned to the registry wallet). */
  async queryMany(filter: QueryFilter): Promise<Record<string, unknown>[]> {
    const page = await this.queryManyBuilder(filter).limit(100).fetch();
    return page.entities as Record<string, unknown>[];
  }

  /** The single row for an identity, or `null` if none exists. */
  async queryOne(identity: Identity): Promise<Record<string, unknown> | null> {
    const rows = await this.queryMany({
      chainId: identity.chainId,
      contract: identity.contract,
      selector: identity.selector,
    });
    return rows.length > 0 ? rows[0]! : null;
  }

  /**
   * The entity key for a record: the existing entity's key if one is already
   * stored under this identity, otherwise the key the next create would mint
   * (owner's current nonce + `NO_SALT`).
   */
  async keyFor(rec: EntityRecord): Promise<Hex> {
    const existing = await this.queryOne(identityOf(rec));
    if (existing) return existing.$key as Hex;
    return this.predictNextKey();
  }

  /** Create-or-patch by identity. Returns the entity key and the tx hash. */
  async upsert(rec: EntityRecord, meta: WriteMeta): Promise<UpsertResult> {
    const existing = await this.queryOne(identityOf(rec));
    const values = toValues(rec, meta);

    if (existing) {
      const entityKey = existing.$key as Hex;
      const unset = OPTIONAL_COLUMNS.filter((c) => values[c] === undefined);
      const { txHash } = await this.wallet.patchEntity(ClearSignDescriptor, entityKey, {
        set: values,
        ...(unset.length > 0 ? { unset } : {}),
      });
      return { entityKey, txHash, created: false };
    }

    const { entityKey, txHash } = await this.wallet.createEntity(
      ClearSignDescriptor,
      values,
      {
        // schema.md asks for a long-lived entry (nominally 365d) re-extended on
        // every sync pass. The Rabdi engine caps a single lifetime at
        // MAX_LIFETIME (~182 days), so fromDays(365) is refused on-chain. Use the
        // longest practical lifetime under the cap; the sync re-extends it.
        expiration: ExpirationTime.fromDays(180),
        flags: { permissionlessExtension: true },
        salt: NO_SALT,
      },
    );
    return { entityKey, txHash, created: true };
  }

  /** Delete the entity with the given key. */
  async remove(entityKey: Hex): Promise<{ txHash: Hex }> {
    const { txHash } = await this.wallet.deleteEntity({ entityKey });
    return { txHash };
  }

  private async predictNextKey(): Promise<Hex> {
    const nonce = await this.reader.getEntityNonce(this.registryWallet);
    return predictEntityKey({
      owner: this.registryWallet,
      nonce,
      salt: NO_SALT,
      chainId: this.chainId,
    });
  }
}

function identityOf(rec: EntityRecord): Identity {
  return { chainId: rec.chainId, contract: rec.contract, selector: rec.selector };
}

/** Wrap each filter field as its column's typed value for `eq(...)`. */
function buildPredicates(filter: QueryFilter) {
  const preds = [];
  if (filter.chainId !== undefined) preds.push(eq('chainId', u64(BigInt(filter.chainId))));
  if (filter.contract !== undefined) preds.push(eq('contract', addr(filter.contract.toLowerCase())));
  if (filter.selector !== undefined) preds.push(eq('selector', str(filter.selector)));
  if (filter.kind !== undefined) preds.push(eq('kind', str(filter.kind)));
  if (filter.intent !== undefined) preds.push(eq('intent', str(filter.intent)));
  if (filter.entityName !== undefined) preds.push(eq('entityName', str(filter.entityName)));
  if (filter.contractName !== undefined) preds.push(eq('contractName', str(filter.contractName)));
  if (filter.functionName !== undefined) preds.push(eq('functionName', str(filter.functionName)));
  if (filter.functionSignature !== undefined) preds.push(eq('functionSignature', str(filter.functionSignature)));
  if (filter.owner !== undefined) preds.push(eq('owner', str(filter.owner)));
  if (filter.sourcePath !== undefined) preds.push(eq('sourcePath', str(filter.sourcePath)));
  if (filter.source !== undefined) preds.push(eq('source', str(filter.source)));
  if (filter.eip712PrimaryType !== undefined) preds.push(eq('eip712PrimaryType', str(filter.eip712PrimaryType)));
  if (preds.length === 0) {
    throw new Error('queryMany requires at least one filter predicate');
  }
  return preds;
}
