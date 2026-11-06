import { describe, it, expect } from 'vitest';
import type {
  DecodeResponse,
  SigningField,
  VerifiedBlock,
} from '@klarity/sdk';
import { renderInsight } from '../src/render.js';
import type { TokenMeta } from '../src/token.js';

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
 * matches the given name. Children nest under `props.children`, which may be a
 * single node or an array.
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

const interactionContext = {
  chainId: 1,
  contract: '0xcontract',
  selector: '0xa9059cbb',
};

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

  it('shows a decode-error diagnostic when decode failed with an error', () => {
    const out = renderToString(
      renderInsight(null, null, undefined, 'Failed to fetch'),
    );
    expect(out).toContain('No Klarity clear-signing for this transaction.');
    expect(out).toContain('decode error: ');
    expect(out).toContain('Failed to fetch');
  });

  it('does NOT show a diagnostic on a genuine no-descriptor (null error)', () => {
    const out = renderToString(renderInsight(null, null, undefined, null));
    expect(out).not.toContain('decode error:');
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

  it('embeds the klarity-vouch form when a decode and interactionContext are present', () => {
    const el = renderInsight(makeDecode(), efVerified, interactionContext);
    const forms = findByName(el, 'klarity-vouch');
    expect(forms.length).toBe(1);
  });

  it('does NOT embed the vouch form when decode is null', () => {
    const el = renderInsight(null, null, interactionContext);
    const forms = findByName(el, 'klarity-vouch');
    expect(forms.length).toBe(0);
  });

  it('does NOT embed the vouch form when interactionContext is omitted', () => {
    const el = renderInsight(makeDecode(), efVerified);
    const forms = findByName(el, 'klarity-vouch');
    expect(forms.length).toBe(0);
  });

  it('returns a JSX element object with a type', () => {
    const el = renderInsight(makeDecode(), efVerified);
    expect(el).toHaveProperty('type');
    expect(el).toHaveProperty('props');
  });

  it('still shows "-" for a field with no decoded value', () => {
    // visibleFields carry no `value` -> honest dash, not a fabricated value.
    const out = renderToString(renderInsight(makeDecode(), null));
    expect(out).toContain('-');
  });

  const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

  it('formats an integer amount with a known token as "1.0 USDC"', () => {
    const decode = makeDecode({
      fields: [
        {
          label: 'Amount to supply',
          path: 'amount',
          format: 'tokenAmount',
          hidden: false,
          params: { token: USDC },
          value: '1000000',
          type: 'uint256',
        },
      ],
    });
    const tokenMeta = new Map<string, TokenMeta | null>([
      [USDC.toLowerCase(), { decimals: 6, symbol: 'USDC' }],
    ]);
    const out = renderToString(
      renderInsight(decode, null, undefined, null, tokenMeta),
    );
    expect(out).toContain('1.0 USDC');
  });

  it('renders "<raw> (raw)" when token metadata could not be resolved', () => {
    const decode = makeDecode({
      fields: [
        {
          label: 'Amount to supply',
          path: 'amount',
          format: 'tokenAmount',
          hidden: false,
          params: { token: USDC },
          value: '1000000',
          type: 'uint256',
        },
      ],
    });
    const tokenMeta = new Map<string, TokenMeta | null>([
      [USDC.toLowerCase(), null],
    ]);
    const out = renderToString(
      renderInsight(decode, null, undefined, null, tokenMeta),
    );
    expect(out).toContain('1000000 (raw)');
  });

  it('renders an integer with no token address as its plain base-10 value', () => {
    const decode = makeDecode({
      fields: [
        {
          label: 'Referral code',
          path: 'referralCode',
          hidden: false,
          value: '7',
          type: 'uint16',
        },
      ],
    });
    const out = renderToString(renderInsight(decode, null));
    expect(out).toContain('7');
    expect(out).not.toContain('(raw)');
  });

  it('renders an address value as-is', () => {
    const addr = '0x1111111111111111111111111111111111111111';
    const decode = makeDecode({
      fields: [
        { label: 'Recipient', path: 'to', hidden: false, value: addr, type: 'address' },
      ],
    });
    const out = renderToString(renderInsight(decode, null));
    expect(out).toContain(addr);
  });

  it('renders a nested inner call with its decoded fields in a Box', () => {
    const inner: DecodeResponse = {
      signing: {
        chainId: 1,
        contract: '0xinner',
        selector: '0xa9059cbb',
        kind: 'calldata',
        decodedFrom: 'abi',
        interpolatedIntent: null,
        functionSignature: 'transfer(address to, uint256 amount)',
        summary: 'transfer(address,uint256)',
      },
      fields: [
        {
          label: 'Inner recipient',
          path: 'to',
          hidden: false,
          value: '0x2222222222222222222222222222222222222222',
          type: 'address',
        },
      ],
      hiddenFields: [],
      note: 'inner note',
      raw: { calldata: '0xa9059cbb0000' },
    };
    const decode = makeDecode({
      fields: [
        { label: 'Action', path: 'action', hidden: false, value: '0xdead', type: 'bytes', inner },
      ],
    });
    const out = renderToString(renderInsight(decode, null));
    expect(out).toContain('Inner recipient');
    expect(out).toContain('0x2222222222222222222222222222222222222222');
  });

  it('renders an unresolved inner call honestly with the raw selector', () => {
    const inner: DecodeResponse = {
      signing: {
        chainId: 1,
        contract: '0xinner',
        selector: '0xdeadbeef',
        kind: 'calldata',
        decodedFrom: 'abi',
        interpolatedIntent: null,
        summary: 'Unknown inner call',
      },
      fields: [],
      hiddenFields: [],
      note: 'no descriptor',
      raw: { calldata: '0xdeadbeef00001111' },
      unresolved: true,
    };
    const decode = makeDecode({
      fields: [
        { label: 'Action', path: 'action', hidden: false, value: '0xdead', type: 'bytes', inner },
      ],
    });
    const out = renderToString(renderInsight(decode, null));
    expect(out).toContain('Unknown inner call');
    expect(out).toContain('0xdeadbeef');
  });

  it('renders a permit block with its fields', () => {
    const decode = makeDecode({
      fields: [
        {
          label: 'Permit',
          path: 'permit',
          hidden: false,
          value: '0xabc',
          type: 'bytes',
          permit: {
            format: 'eip2612',
            fields: [
              { label: 'Token', value: USDC },
              { label: 'Owner', value: '0x3333333333333333333333333333333333333333' },
              { label: 'Spender', value: '0x4444444444444444444444444444444444444444' },
              { label: 'Value', value: '1000000' },
              { label: 'Deadline', value: '1699999999' },
            ],
            raw: '0xabc',
          },
        },
      ],
    });
    const out = renderToString(renderInsight(decode, null));
    expect(out).toContain('Permit');
    expect(out).toContain('Token');
    expect(out).toContain('Owner');
    expect(out).toContain('Spender');
  });

  it('labels an unrecognized permit honestly', () => {
    const decode = makeDecode({
      fields: [
        {
          label: 'Permit',
          path: 'permit',
          hidden: false,
          value: '0xabcd',
          type: 'bytes',
          permit: { format: 'unknown', fields: [], raw: '0xabcd' },
        },
      ],
    });
    const out = renderToString(renderInsight(decode, null));
    expect(out).toContain('Permit (unrecognized)');
  });
});
