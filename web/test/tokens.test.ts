import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const css = readFileSync(resolve(__dirname, '../styles/tokens.css'), 'utf8');

describe('bencho dark tokens.css', () => {
  const required: Array<[string, string]> = [
    ['--bg', '#000'],
    ['--surface', '#0f0f0f'],
    ['--card', '#0a0a0a'],
    ['--ink', '#fff'],
    ['--ink-2', '#b4b4b4'],
    ['--ink-3', '#9a9a9a'],
    ['--ink-4', '#828282'],
    ['--pick', '#3aa9ff'],
    ['--ok', '#34d17a'],
    ['--guide', '#ff5c84'],
    ['--ink-rgb', '255, 255, 255'],
  ];

  for (const [token, value] of required) {
    it(`defines ${token}: ${value}`, () => {
      // match `--token: value` allowing flexible whitespace around the colon
      const re = new RegExp(
        `${token.replace(/[-]/g, '\\-')}\\s*:\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
      );
      expect(css).toMatch(re);
    });
  }

  it('sets data-theme=dark or :root scope', () => {
    expect(css).toMatch(/:root|\[data-theme="dark"\]/);
  });

  it('contains no emoji', () => {
    const emoji =
      /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{FE00}-\u{FE0F}]/u;
    expect(css).not.toMatch(emoji);
  });
});
