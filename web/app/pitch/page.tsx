'use client';

import './pitch.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { TagChip } from '../../components/Chip';
import { MonoLabel } from '../../components/CodeBlock';

/*
 * /pitch — a presenter-driven, voice-narrated deck. Five near-full-viewport
 * slides, each carrying its argument through a hand-authored inline SVG
 * animation rather than paragraphs of text. Scroll-snap is the core advance
 * mechanism (works with zero JS); prev/next buttons, keyboard, and a dot rail
 * add presenter control. An IntersectionObserver tracks the active slide so
 * each SVG (re)animates on entry.
 *
 * Motion is additive only: every animated element's resting style is its final
 * frame, and keyframes live under `prefers-reduced-motion: no-preference` (see
 * pitch.css). Reduced-motion users therefore see the fully composed end-state
 * of every slide, never a blank or mid-animation frame.
 */

const BEATS = [
  { id: 'wallet', label: '01' },
  { id: 'anon', label: '02' },
  { id: 'unstoppable', label: '03' },
  { id: 'intent', label: '04' },
  { id: 'decode', label: '05' },
  { id: 'single', label: '06' },
  { id: 'blind', label: '07' },
  { id: 'arkiv', label: '08' },
  { id: 'trust', label: '09' },
] as const;

/*
 * The one calldata payload the deck narrates. Slide 1 shows it as an opaque
 * wall of bytes; the Decode beat shows the SAME bytes resolved into intent, so
 * the two slides visibly match. A real-looking ERC-20 approve calldata head
 * padded out to a dense multi-line blob — illustrative, not a live fixture.
 */
const CALLDATA = [
  '0x3593564c000000000000000000000000', // execute(bytes,bytes[],uint256) selector
  '0000000000000000000000000000000060',
  '00000000000000000000000000000000a0',
  '0000000000000000000000006512aef00c',
  '0000000000000000000000000000000002',
  '0a08060000000000000000000000000000',
  'b4c4f3a0c6f1d2e3b5a697887766554433',
  '221100ffeeddccbbaa99887766554433',
  '1f9840a85d5af5bf1d1762f925bdaddc',
  '4201f984000000000000000000000000',
  'a0b86991c6218b36c1d19d4a2e9eb0ce',
  '3606eb48000000000000000000000000',
  '00000000000000000000000003b9aca0',
  '00000000000000000000000000000000',
  '0000000000000000000000000470de4d',
  'f820000000000000000000000000d8ec',
  '3f9c4e2a3b17f0b2c6a1e7d5f90436e1',
  'a2b3c4d5e6f708192a3b4c5d6e7f8091',
  '00000000000000000000000000000000',
  '0000000000000000000000006512b0a4',
].join('');

// Break the blob into fixed-width mono words for a terminal-style byte wall.
const CALLDATA_WORDS = (CALLDATA.replace(/^0x/, '').match(/.{1,8}/g) ?? []).map(
  (w, i) => (i === 0 ? `0x${w}` : w),
);

// The SAME calldata above, decoded. A Uniswap Universal Router `execute` swap —
// a rich multi-field intent, so the contrast with the opaque blob is stark.
const DECODED_SWAP = {
  action: 'Swap on Uniswap',
  fields: [
    { label: 'Pay', value: '1,000 USDC' },
    { label: 'Receive (min)', value: '0.318 ETH' },
    { label: 'To', value: '0xd8ec…6e1a' },
    { label: 'Before', value: '14:32 UTC' },
  ],
};

export default function PitchPage() {
  const deckRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<(HTMLElement | null)[]>([]);
  const [active, setActive] = useState(0);

  const prefersReduced = useCallback(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  const goTo = useCallback(
    (index: number) => {
      const next = Math.max(0, Math.min(BEATS.length - 1, index));
      const el = slideRefs.current[next];
      if (!el) return;
      el.scrollIntoView({ behavior: prefersReduced() ? 'auto' : 'smooth', block: 'start' });
      setActive(next);
    },
    [prefersReduced],
  );

  // Keyboard presenter control. Only intercept keys we actually handle so the
  // page stays usable (tabbing, browser shortcuts) otherwise.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      switch (e.key) {
        case 'ArrowDown':
        case 'ArrowRight':
        case 'PageDown':
        case ' ':
          e.preventDefault();
          setActive((a) => {
            const n = Math.min(BEATS.length - 1, a + 1);
            slideRefs.current[n]?.scrollIntoView({
              behavior: prefersReduced() ? 'auto' : 'smooth',
              block: 'start',
            });
            return n;
          });
          break;
        case 'ArrowUp':
        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault();
          setActive((a) => {
            const n = Math.max(0, a - 1);
            slideRefs.current[n]?.scrollIntoView({
              behavior: prefersReduced() ? 'auto' : 'smooth',
              block: 'start',
            });
            return n;
          });
          break;
        case 'Home':
          e.preventDefault();
          goTo(0);
          break;
        case 'End':
          e.preventDefault();
          goTo(BEATS.length - 1);
          break;
        default:
          break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goTo, prefersReduced]);

  // Track which slide is on screen so per-slide animations fire on entry and
  // the dot rail / nav state stay in sync with manual scrolling.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = slideRefs.current.indexOf(entry.target as HTMLElement);
            if (idx >= 0) setActive(idx);
          }
        }
      },
      { threshold: 0.55 },
    );
    const nodes = slideRefs.current.filter(Boolean) as HTMLElement[];
    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, []);

  const setSlideRef = (i: number) => (el: HTMLElement | null) => {
    slideRefs.current[i] = el;
  };

  return (
    <div className="pitch-root">
      <div className="pitch-deck" ref={deckRef}>
        {/* Beat 1 — The wallet: UI served on-chain, not from a website */}
        <section
          ref={setSlideRef(0)}
          className="pitch-slide"
          data-beat="wallet"
          data-active={active === 0}
          aria-label="A wallet whose interface is served on-chain, with clear-signing built in"
        >
          <div className="pitch-stage">
            <TagChip>ERC-8244</TagChip>
            <h2 className="pitch-head">A wallet, not a website.</h2>
            <WalletSvg />
          </div>
        </section>

        {/* Beat 2 — Anonymous RPC: reads nobody can trace */}
        <section
          ref={setSlideRef(1)}
          className="pitch-slide"
          data-beat="anon"
          data-active={active === 1}
          aria-label="Reads are anonymized through a hash-pinned sandboxed worker"
        >
          <div className="pitch-stage">
            <TagChip>anon-rpc</TagChip>
            <h2 className="pitch-head">Reads nobody can trace.</h2>
            <AnonSvg />
          </div>
        </section>

        {/* Beat 3 — No servers, nothing to seize or censor */}
        <section
          ref={setSlideRef(2)}
          className="pitch-slide"
          data-beat="unstoppable"
          data-active={active === 2}
          aria-label="Served via ENS and IPFS with no servers to seize or censor"
        >
          <div className="pitch-stage">
            <TagChip>ENS · IPFS</TagChip>
            <h2 className="pitch-head">No servers. No off switch.</h2>
            <UnstoppableSvg />
          </div>
        </section>

        {/* Beat 4 — This is what you actually sign (opaque raw calldata) */}
        <section
          ref={setSlideRef(3)}
          className="pitch-slide"
          data-beat="intent"
          data-active={active === 3}
          aria-label="Opaque raw calldata is what a user actually signs"
        >
          <div className="pitch-stage">
            <TagChip>Raw calldata</TagChip>
            <h2 className="pitch-head">This is what you actually sign.</h2>
            <IntentSvg />
          </div>
        </section>

        {/* Beat 5 — Decoded. Safe to sign. (same calldata, resolved) */}
        <section
          ref={setSlideRef(4)}
          className="pitch-slide"
          data-beat="decode"
          data-active={active === 4}
          aria-label="The same calldata decoded into a readable sentence, safe to sign"
        >
          <div className="pitch-stage">
            <TagChip>ERC-7730</TagChip>
            <h2 className="pitch-head">Decoded. Safe to sign.</h2>
            <DecodeSvg />
          </div>
        </section>

        {/* Beat 6 — One registry. One host. */}
        <section
          ref={setSlideRef(5)}
          className="pitch-slide"
          data-beat="single"
          data-active={active === 5}
          aria-label="One registry served from one host"
        >
          <div className="pitch-stage">
            <TagChip>GitHub</TagChip>
            <h2 className="pitch-head">One registry. One host.</h2>
            <SingleHostSvg />
          </div>
        </section>

        {/* Beat 7 — GitHub drops. Wallets go blind. */}
        <section
          ref={setSlideRef(6)}
          className="pitch-slide"
          data-beat="blind"
          data-active={active === 6}
          aria-label="When GitHub drops, wallets fall back to blind signing"
        >
          <div className="pitch-stage">
            <TagChip>Blind signing</TagChip>
            <h2 className="pitch-head">GitHub drops. Wallets go blind.</h2>
            <BlindSvg />
          </div>
        </section>

        {/* Beat 8 — Arkiv: always-available, un-takedownable */}
        <section
          ref={setSlideRef(7)}
          className="pitch-slide"
          data-beat="arkiv"
          data-active={active === 7}
          aria-label="Klarity replicates the registry across Arkiv nodes so links stay available"
        >
          <div className="pitch-stage">
            <TagChip>Arkiv</TagChip>
            <h2 className="pitch-head">Always-available. Un-takedownable.</h2>
            <ArkivSvg />
          </div>
        </section>

        {/* Beat 9 — Attested. Ranked by trust. */}
        <section
          ref={setSlideRef(8)}
          className="pitch-slide"
          data-beat="trust"
          data-active={active === 8}
          aria-label="Descriptors carry attestations and rank by verified trust"
        >
          <div className="pitch-stage">
            <TagChip>Attestation</TagChip>
            <h2 className="pitch-head">Attested. Ranked by trust.</h2>
            <TrustSvg />
          </div>
        </section>
      </div>

      <nav className="pitch-nav" aria-label="Pitch navigation">
        <button
          type="button"
          className="pitch-btn"
          onClick={() => goTo(active - 1)}
          disabled={active === 0}
          aria-label="Previous slide"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
          <span className="pitch-btn-label">Prev</span>
        </button>
        <div className="pitch-dots" role="tablist" aria-label="Slides">
          {BEATS.map((b, i) => (
            <button
              key={b.id}
              type="button"
              role="tab"
              className="pitch-dot"
              data-on={i === active ? 'true' : 'false'}
              aria-selected={i === active}
              aria-current={i === active ? 'true' : undefined}
              aria-label={`Slide ${b.label}`}
              onClick={() => goTo(i)}
            />
          ))}
        </div>
        <button
          type="button"
          className="pitch-btn"
          onClick={() => goTo(active + 1)}
          disabled={active === BEATS.length - 1}
          aria-label="Next slide"
        >
          <span className="pitch-btn-label">
            {active === BEATS.length - 1 ? 'End' : 'Next'}
          </span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </nav>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Beat 1 — the opaque wall. A wallet frame showing a dense, multi-line block of
 * raw calldata: what a user is actually asked to blind-sign. Mono terminal
 * block; the bytes stream in line by line under motion, resting = full blob.
 * ------------------------------------------------------------------------- */
function IntentSvg() {
  return (
    <div className="pitch-svg-wrap">
      <div className="pitch-wallet" data-mode="raw">
        <div className="pitch-wallet-bar">
          <span className="pitch-wallet-dot" />
          <span className="pitch-wallet-title">Confirm transaction</span>
        </div>
        <div className="pitch-wallet-body pitch-wallet-body-raw">
          <pre className="pitch-hexblob" aria-label="Opaque raw calldata">
            {CALLDATA_WORDS.map((w, i) => (
              <span
                className="pitch-hexword"
                key={i}
                style={{ ['--i' as string]: i }}
              >
                {w}
                {(i + 1) % 4 === 0 ? '\n' : ' '}
              </span>
            ))}
          </pre>
          <span className="pitch-hexnote">
            <MonoLabel>{CALLDATA_WORDS.length} words &middot; unreadable</MonoLabel>
          </span>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Beat 4 — Decoded. Safe to sign. The SAME calldata (left, dimmed) resolves
 * into the readable sentence (right), and a slide-to-sign control completes.
 * Resting end-state: decoded sentence + the slider at its confirmed position.
 * ------------------------------------------------------------------------- */
function DecodeSvg() {
  return (
    <div className="pitch-svg-wrap">
      <div className="pitch-wallet pitch-decode" data-mode="clear">
        <div className="pitch-wallet-bar">
          <span className="pitch-wallet-dot" />
          <span className="pitch-wallet-title">Confirm transaction</span>
        </div>
        <div className="pitch-decode-body">
          <pre className="pitch-hexblob pitch-hexblob-sm" aria-hidden="true">
            {CALLDATA_WORDS.map((w, i) => (
              <span key={i}>
                {w}
                {(i + 1) % 4 === 0 ? '\n' : ' '}
              </span>
            ))}
          </pre>
          <svg className="pitch-decode-arrow" viewBox="0 0 40 24" fill="none" aria-hidden="true">
            <path className="pitch-decode-arrow-line" d="M4 12 h26" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
            <path d="M28 6 l7 6 -7 6" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="pitch-decode-sentence">
            <span className="pitch-sentence-lead">{DECODED_SWAP.action}</span>
            <dl className="pitch-decode-fields">
              {DECODED_SWAP.fields.map((f) => (
                <div className="pitch-decode-field" key={f.label}>
                  <dt>{f.label}</dt>
                  <dd>
                    {/^0x/.test(f.value) ? (
                      <MonoLabel>{f.value}</MonoLabel>
                    ) : (
                      <strong>{f.value}</strong>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
        {/* slide-to-sign: track + fill + knob; label swaps at completion */}
        <div
          className="pitch-swipe"
          role="img"
          aria-label="Slide to sign — completed"
        >
          <span className="pitch-swipe-fill" />
          <span className="pitch-swipe-label pitch-swipe-label-idle">Slide to sign</span>
          <span className="pitch-swipe-label pitch-swipe-label-done">Signed</span>
          <span className="pitch-swipe-knob">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="m5 12 5 5 9-11" stroke="var(--accent-ink)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Beat 2 — one GitHub node feeds many wallets. A pulse travels the links.
 * Resting end-state: node + lit green links to all wallets.
 * ------------------------------------------------------------------------- */
function SingleHostSvg() {
  const wallets = [
    { x: 300, y: 36 },
    { x: 320, y: 110 },
    { x: 320, y: 186 },
    { x: 300, y: 260 },
  ];
  return (
    <div className="pitch-svg-wrap">
      <svg className="pitch-svg" viewBox="0 0 360 300" fill="none" role="img" aria-label="A single registry node feeding four wallets">
        {wallets.map((w, i) => (
          <g key={i}>
            <path
              className="pitch-link"
              d={`M70 150 C 170 150, 190 ${w.y + 14}, ${w.x} ${w.y + 14}`}
              stroke="var(--accent)"
              strokeWidth="2"
              style={{ ['--i' as string]: i }}
            />
            <circle className="pitch-pulse" r="4" fill="var(--accent)" style={{ ['--i' as string]: i }}>
              <animateMotion
                dur="2.4s"
                repeatCount="indefinite"
                path={`M70 150 C 170 150, 190 ${w.y + 14}, ${w.x} ${w.y + 14}`}
                begin={`${i * 0.3}s`}
              />
            </circle>
          </g>
        ))}
        {/* registry node */}
        <g className="pitch-node pitch-node-host">
          <rect x="28" y="124" width="52" height="52" rx="12" fill="var(--accent-wash)" stroke="var(--accent)" strokeWidth="2" />
          <path d="M54 136 a16 16 0 0 0 -5 31 c-0.8 0.1 -1.1 -0.4 -1.1 -0.8 l0 -5.6 c-4.4 0.9 -5.3 -2.1 -5.3 -2.1 -0.7 -1.8 -1.8 -2.3 -1.8 -2.3 -1.4 -1 0.1 -1 0.1 -1 1.6 0.1 2.5 1.6 2.5 1.6 1.4 2.5 3.8 1.8 4.7 1.4 0.1 -1.1 0.6 -1.8 1 -2.2 -3.5 -0.4 -7.2 -1.8 -7.2 -7.9 0 -1.8 0.6 -3.2 1.6 -4.3 -0.2 -0.4 -0.7 -2.1 0.2 -4.3 0 0 1.3 -0.4 4.3 1.6 a15 15 0 0 1 7.8 0 c3 -2 4.3 -1.6 4.3 -1.6 0.9 2.2 0.3 3.9 0.2 4.3 1 1.1 1.6 2.5 1.6 4.3 0 6.1 -3.7 7.5 -7.3 7.9 0.6 0.5 1.1 1.5 1.1 3 l0 4.5 c0 0.4 -0.3 0.9 -1.1 0.8 a16 16 0 0 0 -5 -31 z" fill="var(--accent)" />
        </g>
        {wallets.map((w, i) => (
          <g key={`w${i}`} className="pitch-wlt">
            <rect x={w.x} y={w.y} width="30" height="28" rx="6" fill="var(--surface-2)" stroke="var(--border-strong)" strokeWidth="1.5" />
            <line x1={w.x + 7} y1={w.y + 18} x2={w.x + 23} y2={w.y + 18} stroke="var(--ink-4)" strokeWidth="2" strokeLinecap="round" />
          </g>
        ))}
      </svg>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Beat 3 — the single link snaps, the host greys out, and the wallet flips
 * from a readable sentence back to raw hex with a BLIND SIGNING warning.
 * Resting end-state: broken grey link + blind-signing wallet.
 * ------------------------------------------------------------------------- */
function BlindSvg() {
  return (
    <div className="pitch-svg-wrap">
      <svg className="pitch-svg" viewBox="0 0 360 300" fill="none" role="img" aria-label="The single link snaps and the wallet falls back to blind signing">
        {/* greyed-out host */}
        <g className="pitch-node pitch-node-down">
          <rect x="28" y="124" width="52" height="52" rx="12" fill="var(--surface-2)" stroke="var(--ink-5)" strokeWidth="2" />
          <path d="M40 136 l24 24 M64 136 l-24 24" stroke="var(--ink-4)" strokeWidth="2.5" strokeLinecap="round" />
        </g>
        {/* broken link — two halves with a gap */}
        <path className="pitch-break pitch-break-a" d="M80 150 C 150 150, 165 150, 188 150" stroke="var(--ink-5)" strokeWidth="2" strokeDasharray="6 6" strokeLinecap="round" />
        <path className="pitch-break pitch-break-b" d="M232 150 C 255 150, 270 150, 300 150" stroke="var(--ink-5)" strokeWidth="2" strokeDasharray="6 6" strokeLinecap="round" />
        {/* warning mark at the break */}
        <g className="pitch-warn">
          <path d="M210 134 l18 32 h-36 z" fill="none" stroke="var(--ink)" strokeWidth="2.5" strokeLinejoin="round" />
          <line x1="210" y1="146" x2="210" y2="156" stroke="var(--ink)" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="210" cy="161" r="1.6" fill="var(--ink)" />
        </g>
        {/* wallet flipped to raw hex */}
        <g className="pitch-blindwlt">
          <rect x="296" y="118" width="56" height="64" rx="8" fill="var(--surface-2)" stroke="var(--border-strong)" strokeWidth="1.5" />
          <text x="324" y="138" className="pitch-blind-hex" textAnchor="middle">0xa9059c</text>
          <text x="324" y="150" className="pitch-blind-hex" textAnchor="middle">bb0000c0</text>
          <text x="324" y="162" className="pitch-blind-hex" textAnchor="middle">2aaa390f</text>
          <text x="324" y="176" className="pitch-blind-tag" textAnchor="middle">BLIND</text>
        </g>
      </svg>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Beat 4 — the registry replicated across a ring of Arkiv nodes. Redundant
 * links stay lit; one node can dim and the others keep the wallet served.
 * Resting end-state: full mesh, all links lit.
 * ------------------------------------------------------------------------- */
function ArkivSvg() {
  const nodes = [
    { x: 60, y: 70 },
    { x: 60, y: 150 },
    { x: 60, y: 230 },
    { x: 130, y: 110 },
    { x: 130, y: 190 },
  ];
  const wallet = { x: 292, y: 134 };
  return (
    <div className="pitch-svg-wrap">
      <svg className="pitch-svg" viewBox="0 0 360 300" fill="none" role="img" aria-label="The registry replicated across five Arkiv nodes with redundant links to the wallet">
        {nodes.map((n, i) => (
          <path
            key={`l${i}`}
            className="pitch-mesh-link"
            d={`M${n.x + 18} ${n.y + 9} C 210 ${n.y + 9}, 240 ${wallet.y + 16}, ${wallet.x} ${wallet.y + 16}`}
            stroke="var(--accent)"
            strokeWidth="1.6"
            style={{ ['--i' as string]: i }}
            data-dim={i === 2 ? 'true' : 'false'}
          />
        ))}
        {nodes.map((n, i) => (
          <g key={`n${i}`} className="pitch-mesh-node" data-dim={i === 2 ? 'true' : 'false'} style={{ ['--i' as string]: i }}>
            <rect x={n.x} y={n.y} width="36" height="18" rx="5" fill="var(--accent-wash)" stroke="var(--accent)" strokeWidth="1.6" />
            <circle cx={n.x + 9} cy={n.y + 9} r="2.4" fill="var(--accent)" />
            <circle cx={n.x + 18} cy={n.y + 9} r="2.4" fill="var(--accent)" />
            <circle cx={n.x + 27} cy={n.y + 9} r="2.4" fill="var(--accent)" />
          </g>
        ))}
        <g className="pitch-wlt-lit">
          <rect x={wallet.x} y={wallet.y} width="34" height="32" rx="7" fill="var(--surface-2)" stroke="var(--accent)" strokeWidth="2" />
          <path d={`M${wallet.x + 9} ${wallet.y + 16} l5 5 l11 -12`} stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </g>
      </svg>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Beat 5 — descriptor rows carry attestation ticks and verified-score bars,
 * then re-order so the highest-trust descriptor rises to the top.
 * Resting end-state: sorted rows, ticks drawn, bars filled.
 * ------------------------------------------------------------------------- */
function TrustSvg() {
  // Resting order (already sorted by score desc); each row's `--from` is where
  // it starts before the rise animation settles it into place.
  const rows = [
    { name: 'Uniswap · swap', score: 96, from: 2 },
    { name: 'Aave · supply', score: 88, from: 0 },
    { name: '1inch · unoswap', score: 71, from: 3 },
    { name: 'unknown · 0x…', score: 24, from: 1, low: true },
  ];
  return (
    <div className="pitch-svg-wrap">
      <ul className="pitch-ranklist" aria-label="Descriptors ranked by verified trust score">
        {rows.map((r, i) => (
          <li
            key={r.name}
            className="pitch-rankrow"
            data-low={r.low ? 'true' : 'false'}
            style={{ ['--from' as string]: r.from, ['--i' as string]: i }}
          >
            <svg className="pitch-tick" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="10" stroke={r.low ? 'var(--ink-5)' : 'var(--accent)'} strokeWidth="2" />
              {r.low ? (
                <path d="M9 9 l6 6 M15 9 l-6 6" stroke="var(--ink-5)" strokeWidth="2" strokeLinecap="round" />
              ) : (
                <path className="pitch-tick-path" d="M8 12.5 l2.6 2.6 L16 9.5" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              )}
            </svg>
            <span className="pitch-rankname">
              <MonoLabel>{r.name}</MonoLabel>
            </span>
            <span className="pitch-scorebar" aria-hidden="true">
              <span
                className="pitch-scorefill"
                data-low={r.low ? 'true' : 'false'}
                style={{ ['--w' as string]: `${r.score}%` }}
              />
            </span>
            <span className="pitch-scorenum">{r.score}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Beat — A wallet, not a website. The UI is served by the contract itself
 * (ERC-8244 html()), fetched over the same RPC the wallet trusts — no frontend
 * host to phish.
 * ------------------------------------------------------------------------- */
function WalletSvg() {
  return (
    <div className="pitch-svg-wrap">
      <div className="pitch-chain" aria-hidden="true">
        <span className="pitch-chain-node pitch-chain-contract">
          <MonoLabel>html()</MonoLabel>
        </span>
        <span className="pitch-chain-link" />
        <span className="pitch-chain-node pitch-chain-wallet">
          <span className="pitch-wallet-bar">
            <span className="pitch-wallet-dot" />
            <span className="pitch-wallet-title">Klarity Wallet</span>
          </span>
          <span className="pitch-wallet-ui">
            <span className="pitch-ui-line" />
            <span className="pitch-ui-line pitch-ui-line-sm" />
            <span className="pitch-ui-pill">Swap 1,000 USDC → ETH</span>
          </span>
        </span>
      </div>
      <p className="pitch-caption">
        <MonoLabel>UI served on-chain · no frontend to phish</MonoLabel>
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Beat — Reads nobody can trace. RPC goes through a hash-pinned worker in a
 * null-origin sandbox; the user's IP is unlinked from the request.
 * ------------------------------------------------------------------------- */
function AnonSvg() {
  return (
    <div className="pitch-svg-wrap">
      <div className="pitch-anon" aria-hidden="true">
        <span className="pitch-anon-node">You</span>
        <span className="pitch-anon-box">
          <span className="pitch-anon-shield">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 2 L20 5 V11 C20 16 16.5 19.5 12 22 C7.5 19.5 4 16 4 11 V5 Z" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" fill="none" />
              <path className="pitch-tick-path" d="M8.5 12 l2.5 2.5 L15.5 9.5" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          </span>
          <MonoLabel>hash-pinned worker</MonoLabel>
        </span>
        <span className="pitch-anon-node">Chain</span>
      </div>
      <p className="pitch-caption">
        <MonoLabel>IP unlinked · sandboxed · content-addressed</MonoLabel>
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Beat — No servers. No off switch. Resolved via ENS → IPFS; nothing to seize,
 * poison, or censor. The uncensorable close.
 * ------------------------------------------------------------------------- */
function UnstoppableSvg() {
  const rails = [
    { k: 'ENS', v: 'klarity.eth' },
    { k: 'IPFS', v: 'ipfs://…' },
    { k: 'anon-rpc', v: 'keccak-pinned' },
    { k: 'ERC-8244', v: 'on-chain UI' },
  ];
  return (
    <div className="pitch-svg-wrap">
      <ul className="pitch-pillars" aria-label="Decentralized building blocks, no central host">
        {rails.map((r, i) => (
          <li
            key={r.k}
            className="pitch-pillar"
            style={{ ['--i' as string]: i }}
          >
            <span className="pitch-pillar-k">
              <MonoLabel>{r.k}</MonoLabel>
            </span>
            <span className="pitch-pillar-v">{r.v}</span>
          </li>
        ))}
      </ul>
      <p className="pitch-caption pitch-caption-strong">
        No backend. No server. Nothing to take down.
      </p>
    </div>
  );
}
