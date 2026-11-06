import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const css = readFileSync(resolve(__dirname, '../styles/tokens.css'), 'utf8');

describe('light theme tokens.css', () => {
  it("defines a [data-theme='light'] block", () => {
    expect(css).toMatch(/\[data-theme='light'\]\s*\{/);
  });

  // Isolate the light block so assertions do not accidentally match the dark set.
  const lightBlock = (() => {
    const start = css.indexOf("[data-theme='light']");
    expect(start).toBeGreaterThan(-1);
    const open = css.indexOf('{', start);
    const close = css.indexOf('}', open);
    return css.slice(open, close);
  })();

  const overrides: Array<[string, string]> = [
    ['--bg', '#fafafa'],
    ['--ink', '#0a0a0a'],
    ['--ink-rgb', '17, 17, 17'],
  ];

  for (const [token, value] of overrides) {
    it(`light overrides ${token}: ${value}`, () => {
      const re = new RegExp(
        `${token.replace(/[-]/g, '\\-')}\\s*:\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
      );
      expect(lightBlock).toMatch(re);
    });
  }

  it('keeps the accent tokens present on light', () => {
    for (const t of ['--pick', '--ok', '--guide']) {
      expect(lightBlock).toMatch(new RegExp(`${t.replace(/[-]/g, '\\-')}\\s*:`));
    }
  });

  it('contains no emoji', () => {
    const emoji =
      /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{FE00}-\u{FE0F}]/u;
    expect(css).not.toMatch(emoji);
  });
});
