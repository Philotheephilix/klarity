/**
 * Small presentational helpers for the rich explorer cards. Pure functions so
 * they are trivially testable and shared across the company/contract/call grids.
 */

/** Up to two uppercase initials derived from a name, for the monogram tile. */
export function monogram(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return '?';
  const parts = cleaned.split(/[\s_\-:/]+/).filter(Boolean);
  if (parts.length === 0) return cleaned.slice(0, 2).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/**
 * Inline style for a generated monogram thumbnail block. Flat, neutral surface
 * (no gradients / per-key hues) so every card reads the same in the
 * single-accent design system. Kept as a function so callers stay unchanged.
 */
export function thumbStyle(_key: string): Record<string, string> {
  return {
    background: 'var(--surface-2)',
  };
}

/** 0x-prefixed address shortened to head...tail. */
export function shortAddress(address: string): string {
  if (address.length <= 14) return address;
  return `${address.slice(0, 10)}...${address.slice(-4)}`;
}

/**
 * Derive a human "source" from a registry sourcePath like
 * `registry/aave/weth.json` -> `aave/weth.json`.
 */
export function sourceLabel(sourcePath: string): string {
  if (!sourcePath) return 'registry';
  const parts = sourcePath.split('/').filter(Boolean);
  if (parts.length <= 1) return sourcePath;
  return parts.slice(-2).join('/');
}
