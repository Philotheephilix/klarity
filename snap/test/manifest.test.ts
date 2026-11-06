import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const snapRoot = resolve(here, '..');

const manifestPath = resolve(snapRoot, 'snap.manifest.json');
const indexPath = resolve(snapRoot, 'src/index.ts');

// Emoji ranges: emoticons, symbols & pictographs, transport, misc symbols,
// dingbats, supplemental symbols, variation selectors, and regional indicators.
const EMOJI_REGEX =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F000}-\u{1F0FF}\u{1F1E6}-\u{1F1FF}]/u;

describe('snap.manifest.json', () => {
  const manifestRaw = readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestRaw) as {
    initialPermissions: Record<string, unknown>;
    source: { location: { npm: { filePath: string } } };
  };

  it('declares exactly the five required initialPermissions', () => {
    const keys = Object.keys(manifest.initialPermissions).sort();
    expect(keys).toEqual(
      [
        'endowment:ethereum-provider',
        'endowment:network-access',
        'endowment:transaction-insight',
        'snap_dialog',
        'snap_manage_state',
      ].sort(),
    );
  });

  it('enables allowTransactionOrigin on transaction-insight', () => {
    const insight = manifest.initialPermissions[
      'endowment:transaction-insight'
    ] as { allowTransactionOrigin?: boolean };
    expect(insight.allowTransactionOrigin).toBe(true);
  });

  it('points the bundle source at src/index.ts', () => {
    expect(indexPath.endsWith('src/index.ts')).toBe(true);
    const bundlePath = manifest.source.location.npm.filePath;
    expect(bundlePath).toMatch(/bundle\.js$/);
  });

  it('contains no emoji in the manifest', () => {
    expect(EMOJI_REGEX.test(manifestRaw)).toBe(false);
  });

  it('contains no emoji in src/index.ts', () => {
    const indexRaw = readFileSync(indexPath, 'utf8');
    expect(EMOJI_REGEX.test(indexRaw)).toBe(false);
  });
});
