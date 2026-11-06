import { describe, it, expect } from 'vitest';
import type {
  DecodeResponse,
  SigningField,
  VerifiedBlock,
} from '@klarity/sdk';
import { renderInsight } from '../src/render.js';

/**
 * Flatten a rendered Snaps JSX element into a single string of all the text it
 * carries. The Snaps JSX runtime returns plain `{ type, props, key }` objects
 * with children nested in `props.children`, so a JSON serialization captures
 * every string leaf in the tree.
 */
function renderToString(element: unknown): string {
  return JSON.stringify(element);
}

const visibleFields: SigningField[] = [
  { label: 'Recipient', path: 'to', hidden: false },
  { label: 'Amount', path: 'value', format: 'token', hidden: false },
];

const hiddenFields: SigningField[] = [
  { label: 'Deadline', path: 'deadline', hidden: true },
];

function makeDecode(overrides: Partial<DecodeResponse> = {}): DecodeResponse {
  return {
    signing: {
      chainId: 1,
      contract: '0xcontract',
      selector: '0xa9059cbb',
      kind: 'calldata',
      decodedFrom: 'abi',
      interpolatedIntent: 'Send 10 USDC to alice.eth',
      summary: 'transfer(address,uint256)',
    },
    fields: visibleFields,
    hiddenFields,
    note: 'Klarity note: this descriptor is community-sourced. Verify before signing.',
    raw: { calldata: '0xa9059cbb' },
    ...overrides,
  };
}

const efVerified: VerifiedBlock = {
  efApproved: true,
  efAttester: '0xef',
  efAttestationUID: '0xuid',
  publicVouches: 3,
  rankedAttesters: [],
};

const unattestedVerified: VerifiedBlock = {
  efApproved: false,
  publicVouches: 1,
  rankedAttesters: [],
};

// Covers emoji, pictographs, symbols, dingbats, and regional indicators.
const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{200D}\u{20E3}]/u;

describe('renderInsight', () => {
  it('renders the interpolatedIntent as the headline', () => {
    const out = renderToString(renderInsight(makeDecode(), null));
    expect(out).toContain('Send 10 USDC to alice.eth');
  });

  it('falls back to intent then summary for the headline', () => {
    const intentOnly = makeDecode({
      signing: {
        ...makeDecode().signing,
        interpolatedIntent: null,
        intent: 'Transfer tokens',
      },
    });
    expect(renderToString(renderInsight(intentOnly, null))).toContain(
      'Transfer tokens',
    );

    const summaryOnly = makeDecode({
      signing: {
        ...makeDecode().signing,
        interpolatedIntent: null,
        intent: undefined,
      },
    });
    expect(renderToString(renderInsight(summaryOnly, null))).toContain(
      'transfer(address,uint256)',
    );
  });

  it('shows every visible field label', () => {
    const out = renderToString(renderInsight(makeDecode(), null));
    for (const field of visibleFields) {
      expect(out).toContain(field.label);
    }
  });

  it('includes the hidden field labels', () => {
    const out = renderToString(renderInsight(makeDecode(), null));
    for (const field of hiddenFields) {
      expect(out).toContain(field.label);
    }
  });

  it('renders the note verbatim', () => {
    const decode = makeDecode();
    const out = renderToString(renderInsight(decode, null));
    expect(out).toContain(decode.note);
  });

  it('renders an honest EF-attested trust line with vouch count', () => {
    const out = renderToString(renderInsight(makeDecode(), efVerified));
    expect(out).toContain('EF-attested');
    expect(out).toContain('3 public vouches');
  });

  it('renders "Not EF-attested" when verified is null', () => {
    const out = renderToString(renderInsight(makeDecode(), null));
    expect(out).toContain('Not EF-attested');
  });

  it('renders "Not EF-attested" for an unattested descriptor with vouches', () => {
    const out = renderToString(renderInsight(makeDecode(), unattestedVerified));
    expect(out).toContain('Not EF-attested');
    expect(out).toContain('1 public vouches');
    expect(out).not.toContain('"safe"');
    expect(out).not.toMatch(/verified|trusted/i);
  });

  it('renders the exact no-data panel when decode is null', () => {
    const out = renderToString(renderInsight(null, null));
    expect(out).toContain('No Klarity clear-signing for this transaction.');
  });

  it('contains no emoji in any rendered string', () => {
    const strings = [
      renderToString(renderInsight(makeDecode(), efVerified)),
      renderToString(renderInsight(makeDecode(), unattestedVerified)),
      renderToString(renderInsight(null, null)),
    ];
    for (const s of strings) {
      expect(s).not.toMatch(EMOJI_RE);
    }
  });

  it('returns a JSX element object with a type', () => {
    const el = renderInsight(makeDecode(), efVerified);
    expect(el).toHaveProperty('type');
    expect(el).toHaveProperty('props');
  });
});
