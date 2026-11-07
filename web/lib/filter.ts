import type { DescriptorRow } from './types';

/**
 * Filter descriptor rows for the Contracts ([entity]) list page.
 * Matches the landing page idiom: case-insensitive, trimmed; empty query is a no-op.
 * Matches against contract name, contract address, function name, and selector.
 */
export function filterContractRows(rows: DescriptorRow[], query: string): DescriptorRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (row) =>
      row.contractName.toLowerCase().includes(q) ||
      row.contract.toLowerCase().includes(q) ||
      (row.functionName?.toLowerCase().includes(q) ?? false) ||
      row.selector.toLowerCase().includes(q),
  );
}

/**
 * Filter descriptor rows for the Calls list page.
 * Case-insensitive, trimmed; empty query is a no-op.
 * Matches against function name, selector, and intent.
 */
export function filterCallRows(rows: DescriptorRow[], query: string): DescriptorRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (row) =>
      (row.functionName?.toLowerCase().includes(q) ?? false) ||
      row.selector.toLowerCase().includes(q) ||
      row.intent.toLowerCase().includes(q),
  );
}
