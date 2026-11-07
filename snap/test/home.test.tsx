import { describe, it, expect } from 'vitest';

import { renderHome } from '../src/home.js';
import type { PendingVouch } from '../src/pending.js';

/**
 * Serialize a rendered Snaps JSX tree to a string. The Snaps JSX runtime
 * returns plain `{ type, props, key }` objects with children nested under
 * `props.children`, so a JSON serialization captures every string leaf.
 */
function renderToString(element: unknown): string {
  return JSON.stringify(element);
}

const PENDING: PendingVouch = {
  chainId: 1,
  contract: '0xabc0000000000000000000000000000000000000',
  selector: '0xa9059cbb',
  interactionTxHash: '0xtx1',
  account: '0xfeed000000000000000000000000000000000000',
  rating: 4,
  comment: 'looks right',
  createdAt: 1700000000000,
};

const SUBMITTED: PendingVouch = {
  chainId: 1,
  contract: '0xdef0000000000000000000000000000000000000',
  selector: '0xa9059cbb',
  interactionTxHash: '0xtx2',
  account: '0xfeed000000000000000000000000000000000000',
  rating: 5,
  comment: 'done',
  createdAt: 1700000000000,
  attemptedUid: '0xUID123',
};

describe('renderHome', () => {
  it('shows an empty-state message when there are no vouches', () => {
    const out = renderToString(renderHome([]));
    expect(out).toContain('No pending vouches');
  });

  it('renders a pending vouch with its contract and rating', () => {
    const out = renderToString(renderHome([PENDING]));
    expect(out).toContain(PENDING.contract);
    expect(out).toContain('4');
  });

  it('renders a submitted vouch with its UID and contract', () => {
    const out = renderToString(renderHome([SUBMITTED]));
    expect(out).toContain('0xUID123');
    expect(out).toContain(SUBMITTED.contract);
  });

  it('contains no non-ASCII characters (no emoji)', () => {
    const out = renderToString(renderHome([PENDING, SUBMITTED]));
    // eslint-disable-next-line no-control-regex
    expect(/^[\u0000-\u007F]*$/u.test(out)).toBe(true);
  });
});
