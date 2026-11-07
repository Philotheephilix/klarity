import { describe, it, expect } from 'vitest';
import {
  renderVouchForm,
  parseVouchInput,
  COMMENT_MAX,
} from '../src/vouch-form.js';

/**
 * Flatten a rendered Snaps JSX element into a single string of all the text it
 * carries. The Snaps JSX runtime returns plain `{ type, props, key }` objects
 * with children nested in `props.children`, so a JSON serialization captures
 * every string leaf in the tree.
 */
function renderToString(element: unknown): string {
  return JSON.stringify(element);
}

/**
 * Recursively walk a Snaps JSX tree collecting every element whose `props.name`
 * matches the given name. The runtime nests children under `props.children`,
 * which may be a single node or an array.
 */
function findByName(element: unknown, name: string): unknown[] {
  const found: unknown[] = [];
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) {
        visit(child);
      }
      return;
    }
    const el = node as { props?: Record<string, unknown> };
    if (el.props && el.props.name === name) {
      found.push(node);
    }
    if (el.props && 'children' in el.props) {
      visit(el.props.children);
    }
  };
  visit(element);
  return found;
}

// Covers emoji, pictographs, symbols, dingbats, and regional indicators.
const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{200D}\u{20E3}]/u;

const interactionContext = {
  chainId: 1,
  contract: '0xcontract',
  selector: '0xa9059cbb',
};

describe('renderVouchForm', () => {
  it('returns a Form named klarity-vouch', () => {
    const el = renderVouchForm({ contract: '0xcontract', interactionContext });
    const forms = findByName(el, 'klarity-vouch');
    expect(forms.length).toBe(1);
  });

  it('contains a RadioGroup named rating', () => {
    const el = renderVouchForm({ contract: '0xcontract', interactionContext });
    const groups = findByName(el, 'rating');
    expect(groups.length).toBe(1);
  });

  it('contains an Input named comment', () => {
    const el = renderVouchForm({ contract: '0xcontract', interactionContext });
    const inputs = findByName(el, 'comment');
    expect(inputs.length).toBe(1);
  });

  it('contains a submit Button with the exact label', () => {
    const el = renderVouchForm({ contract: '0xcontract', interactionContext });
    const out = renderToString(el);
    expect(out).toContain('Looks good — vouch when mined');
    const buttons = findByName(el, 'submit');
    expect(buttons.length).toBe(1);
  });

  it('contains no emoji in any rendered string', () => {
    const el = renderVouchForm({ contract: '0xcontract', interactionContext });
    expect(renderToString(el)).not.toMatch(EMOJI_RE);
  });

  it('returns a JSX element object with a type', () => {
    const el = renderVouchForm({ contract: '0xcontract', interactionContext });
    expect(el).toHaveProperty('type');
    expect(el).toHaveProperty('props');
  });
});

describe('parseVouchInput', () => {
  it('parses a valid rating and comment', () => {
    expect(parseVouchInput({ rating: '5', comment: 'ok' })).toStrictEqual({
      rating: 5,
      comment: 'ok',
    });
  });

  it('rejects a rating below the uint8 floor', () => {
    const out = parseVouchInput({ rating: '0' });
    expect(out).toHaveProperty('error');
    expect(typeof (out as { error: string }).error).toBe('string');
  });

  it('rejects a rating above the uint8 ceiling', () => {
    const out = parseVouchInput({ rating: '999' });
    expect(out).toHaveProperty('error');
    expect(typeof (out as { error: string }).error).toBe('string');
  });

  it('rejects a non-integer rating', () => {
    const out = parseVouchInput({ rating: '3.5' });
    expect(out).toHaveProperty('error');
  });

  it('rejects an unparseable rating', () => {
    const out = parseVouchInput({ rating: 'abc' });
    expect(out).toHaveProperty('error');
  });

  it('rejects a missing rating', () => {
    const out = parseVouchInput({});
    expect(out).toHaveProperty('error');
  });

  it('accepts the uint8 ceiling of 255', () => {
    expect(parseVouchInput({ rating: '255', comment: '' })).toStrictEqual({
      rating: 255,
      comment: '',
    });
  });

  it('coerces a missing comment to an empty string', () => {
    expect(parseVouchInput({ rating: '4' })).toStrictEqual({
      rating: 4,
      comment: '',
    });
  });

  it('truncates an over-long comment to COMMENT_MAX', () => {
    const long = 'a'.repeat(400);
    const out = parseVouchInput({ rating: '5', comment: long });
    expect(out).not.toHaveProperty('error');
    expect((out as { comment: string }).comment.length).toBe(COMMENT_MAX);
    expect(COMMENT_MAX).toBe(280);
  });
});
