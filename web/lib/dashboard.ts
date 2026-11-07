import { makeApi } from './config';
import type { DescriptorRow } from './types';

// Entities the registry actually has data for. 1inch/aave are page-capped at
// 100 by the API; celo returns an exact 56. dai/okx/safe are intentionally
// omitted here because the live API returns zero rows for them — featuring them
// would imply data that does not exist.
export const DASHBOARD_ENTITIES = ['1inch', 'aave', 'celo'] as const;

// The API caps a single /descriptors page at 100 rows, so any entity/chain
// bucket that lands on exactly 100 is display-capped, not necessarily exact.
export const PAGE_CAP = 100;

// Human-facing chain names for the chainIds present in the corpus.
export const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  10: 'Optimism',
  56: 'BNB Chain',
  100: 'Gnosis',
  137: 'Polygon',
  8453: 'Base',
  42161: 'Arbitrum',
  43114: 'Avalanche',
};

export interface CountBucket {
  key: string;
  label: string;
  count: number;
  /** true when count hit the API page cap, so the real total is "count+". */
  capped: boolean;
}

export interface EntityStat {
  entityName: string;
  displayName: string;
  count: number;
  capped: boolean;
  /** honest status proxy: see STATUS_PROXY_NOTE. */
  status: StatusKey;
}

export type StatusKey = 'verified' | 'pending' | 'unverified';

export interface StatusSplit {
  verified: number;
  pending: number;
  unverified: number;
}

export interface DashboardVM {
  totalDescriptors: number;
  totalCapped: boolean;
  entitiesWithData: number;
  distinctContracts: number;
  distinctChains: number;
  perEntity: EntityStat[];
  perChain: CountBucket[];
  statusSplit: StatusSplit;
  /** share of rows classified "verified" by the proxy, 0..100 integer. */
  verifiedPct: number;
  recent: DescriptorRow[];
}

const DISPLAY_NAMES: Record<string, string> = {
  '1inch': '1inch',
  aave: 'Aave',
  celo: 'Celo',
};

// STATUS_PROXY_NOTE — there is NO verification/attestation field in DescriptorRow.
// We derive an HONEST proxy from the one signal we do have, `kind`:
//   kind === 'eip712'   -> "verified"   (typed-data descriptors carry an explicit
//                                        on-chain domain/primaryType, our strongest signal)
//   kind === 'calldata' -> "pending"    (selector-only, weaker provenance)
// This is a labelling convention for the dashboard gauge/pills, NOT a claim of an
// on-chain attestation status. Legend labels say "Typed (verified) / Calldata
// (pending)" so the proxy is visible to the reader. "unverified" stays available
// for rows missing a kind, which should not occur in practice.
export function statusForRow(row: DescriptorRow): StatusKey {
  if (row.kind === 'eip712') return 'verified';
  if (row.kind === 'calldata') return 'pending';
  return 'unverified';
}

/** Dominant status across an entity's rows, for its list pill. */
function dominantStatus(rows: DescriptorRow[]): StatusKey {
  const split = splitStatus(rows);
  if (split.verified >= split.pending && split.verified >= split.unverified) {
    return split.verified > 0 ? 'verified' : 'pending';
  }
  if (split.pending >= split.unverified) return 'pending';
  return 'unverified';
}

function splitStatus(rows: DescriptorRow[]): StatusSplit {
  const split: StatusSplit = { verified: 0, pending: 0, unverified: 0 };
  for (const r of rows) split[statusForRow(r)] += 1;
  return split;
}

/**
 * Pure view-model builder. Takes the already-fetched rows (one array per
 * dashboard entity, in DASHBOARD_ENTITIES order) and derives every number the
 * dashboard renders. Kept pure so it is directly unit-testable.
 */
export function buildDashboardVM(rowsByEntity: DescriptorRow[][]): DashboardVM {
  const all = rowsByEntity.flat();

  const perEntity: EntityStat[] = DASHBOARD_ENTITIES.map((entityName, i) => {
    const rows = rowsByEntity[i] ?? [];
    return {
      entityName,
      displayName: DISPLAY_NAMES[entityName] ?? entityName,
      count: rows.length,
      capped: rows.length >= PAGE_CAP,
      status: dominantStatus(rows),
    };
  });

  const entitiesWithData = perEntity.filter((e) => e.count > 0).length;

  const totalDescriptors = all.length;
  const totalCapped = perEntity.some((e) => e.capped);

  const distinctContracts = new Set(all.map((r) => `${r.chainId}:${r.contract}`))
    .size;

  const chainCounts = new Map<number, number>();
  for (const r of all) {
    chainCounts.set(r.chainId, (chainCounts.get(r.chainId) ?? 0) + 1);
  }
  const perChain: CountBucket[] = [...chainCounts.entries()]
    .map(([chainId, count]) => ({
      key: String(chainId),
      label: CHAIN_NAMES[chainId] ?? `Chain ${chainId}`,
      count,
      capped: count >= PAGE_CAP,
    }))
    .sort((a, b) => b.count - a.count || Number(a.key) - Number(b.key));

  const distinctChains = perChain.length;

  const statusSplit = splitStatus(all);
  const classified =
    statusSplit.verified + statusSplit.pending + statusSplit.unverified;
  const verifiedPct =
    classified === 0 ? 0 : Math.round((statusSplit.verified / classified) * 100);

  // Recent list — take the first rows across entities (the API returns them in
  // registry order; there is no timestamp field to sort on).
  const recent = all.slice(0, 6);

  return {
    totalDescriptors,
    totalCapped,
    entitiesWithData,
    distinctContracts,
    distinctChains,
    perEntity,
    perChain,
    statusSplit,
    verifiedPct,
    recent,
  };
}

/** "256" -> "256+" when any contributing bucket was page-capped. */
export function formatCount(count: number, capped: boolean): string {
  return capped ? `${count}+` : String(count);
}

/**
 * Fetch rows for the dashboard entities in parallel and build the view-model.
 * Thin wrapper around buildDashboardVM so the heavy logic stays pure/testable.
 */
export async function fetchDashboardVM(): Promise<DashboardVM> {
  const api = makeApi();
  const rowsByEntity = await Promise.all(
    DASHBOARD_ENTITIES.map((entityName) =>
      api.listDescriptors({ entityName }),
    ),
  );
  return buildDashboardVM(rowsByEntity);
}
