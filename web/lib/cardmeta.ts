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
 * A deterministic hue (0..359) derived from a key, so each entity/contract gets
 * a stable thumbnail gradient without any external image.
 */
export function hueFromKey(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

/** Inline style for a generated monogram/gradient thumbnail block. */
export function thumbStyle(key: string): Record<string, string> {
  const h = hueFromKey(key);
  const h2 = (h + 42) % 360;
  return {
    background: `linear-gradient(135deg, hsl(${h} 70% 46%), hsl(${h2} 72% 38%))`,
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
