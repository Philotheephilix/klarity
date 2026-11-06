import type { SVGProps } from 'react';

// Original inline-SVG icons drawn for the Klarity dashboard. No third-party
// icon set is copied; each path is hand-authored geometry on a 24x24 grid and
// inherits color via `currentColor` so it themes with tokens.
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 20, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    ...rest,
  };
}

/** Klarity brand mark — an abstract geometric "K" built from a stem + chevron. */
export function KlarityMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className="kl-mark"
    >
      <rect x="2" y="2" width="28" height="28" rx="8" fill="var(--ok)" />
      <path
        d="M11 8v16M11 16l7-8M11 16l7 8"
        stroke="var(--on-ink)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconDashboard(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  );
}

export function IconEntities(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.3" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0M15 19a4.5 4.5 0 0 1 5.5-4.4" />
    </svg>
  );
}

export function IconContracts(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M13 3v4h4M9 12h6M9 16h4" />
    </svg>
  );
}

export function IconCalls(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 7h16M4 12h10M4 17h7" />
      <path d="M17 14l3 3-3 3" />
    </svg>
  );
}

export function IconChains(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="3" y="9" width="7" height="6" rx="2" />
      <rect x="14" y="9" width="7" height="6" rx="2" />
      <path d="M10 12h4" />
    </svg>
  );
}

export function IconSettings(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M4.2 7l2.6 1.5M17.2 15.5l2.6 1.5M4.2 17l2.6-1.5M17.2 8.5l2.6-1.5" />
    </svg>
  );
}

export function IconHelp(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.9.4-1.4 1-1.4 1.9" />
      <circle cx="11.9" cy="16.6" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconMail(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M4 7l8 6 8-6" />
    </svg>
  );
}

export function IconBell(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function IconArrowUpRight(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M7 17 17 7M9 7h8v8" />
    </svg>
  );
}

export function IconPlay(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M8 5.5v13l11-6.5-11-6.5Z" />
    </svg>
  );
}

export function IconPause(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M9 5v14M15 5v14" />
    </svg>
  );
}

export function IconStop(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="6" y="6" width="12" height="12" rx="2.5" />
    </svg>
  );
}

export function IconBook(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5Z" />
      <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20" />
    </svg>
  );
}
