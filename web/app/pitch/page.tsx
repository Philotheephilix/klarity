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
  { id: 'intent', label: '01' },
  { id: 'single', label: '02' },
  { id: 'blind', label: '03' },
  { id: 'arkiv', label: '04' },
  { id: 'trust', label: '05' },
] as const;

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
        {/* Beat 1 — Clear-signing: hex becomes intent */}
        <section
          ref={setSlideRef(0)}
          className="pitch-slide"
          data-beat="intent"
          data-active={active === 0}
          aria-label="Clear-signing turns hex into intent"
        >
          <div className="pitch-stage">
            <TagChip>ERC-7730</TagChip>
            <h2 className="pitch-head">Clear-signing: hex becomes intent.</h2>
            <IntentSvg />
          </div>
        </section>

        {/* Beat 2 — One registry. One host. */}
        <section
          ref={setSlideRef(1)}
          className="pitch-slide"
          data-beat="single"
          data-active={active === 1}
          aria-label="One registry served from one host"
        >
          <div className="pitch-stage">
            <TagChip>GitHub</TagChip>
            <h2 className="pitch-head">One registry. One host.</h2>
            <SingleHostSvg />
          </div>
        </section>

        {/* Beat 3 — GitHub drops. Wallets go blind. */}
        <section
          ref={setSlideRef(2)}
          className="pitch-slide"
          data-beat="blind"
          data-active={active === 2}
          aria-label="When GitHub drops, wallets fall back to blind signing"
        >
          <div className="pitch-stage">
            <TagChip>Blind signing</TagChip>
            <h2 className="pitch-head">GitHub drops. Wallets go blind.</h2>
            <BlindSvg />
          </div>
        </section>

        {/* Beat 4 — Arkiv: always-available, un-takedownable */}
        <section
          ref={setSlideRef(3)}
          className="pitch-slide"
          data-beat="arkiv"
          data-active={active === 3}
          aria-label="Klarity replicates the registry across Arkiv nodes so links stay available"
        >
          <div className="pitch-stage">
            <TagChip>Arkiv</TagChip>
            <h2 className="pitch-head">Always-available. Un-takedownable.</h2>
            <ArkivSvg />
          </div>
        </section>

        {/* Beat 5 — Attested. Ranked by trust. */}
        <section
          ref={setSlideRef(4)}
          className="pitch-slide"
          data-beat="trust"
          data-active={active === 4}
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
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </nav>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Beat 1 — a wallet frame. The raw hex calldata (resting = hidden) animates
 * out and the readable intent sentence (resting = shown) animates in. Static
 * end-state: the readable sentence.
 * ------------------------------------------------------------------------- */
function IntentSvg() {
  return (
    <div className="pitch-svg-wrap">
      <div className="pitch-wallet" data-mode="clear">
        <div className="pitch-wallet-bar">
          <span className="pitch-wallet-dot" />
          <span className="pitch-wallet-title">Confirm transaction</span>
        </div>
        <div className="pitch-wallet-body">
          <div className="pitch-hex" aria-hidden="true">
            <MonoLabel>0xa9059cbb000000000000000000000000c02aaa39&hellip;0f5986</MonoLabel>
          </div>
          <div className="pitch-sentence">
            <span className="pitch-sentence-lead">Approve</span>{' '}
            <strong>1,000 USDC</strong> to <MonoLabel>0x1f98&hellip;a984</MonoLabel>
          </div>
          <svg className="pitch-morph" viewBox="0 0 320 24" fill="none" aria-hidden="true">
            <line className="pitch-morph-line" x1="8" y1="12" x2="312" y2="12" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeDasharray="304" />
          </svg>
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
