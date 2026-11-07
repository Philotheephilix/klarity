import type { ReactNode } from 'react';
import './globals.css';
import { AppShell } from '../components/AppShell';

export const metadata = {
  title: 'Klarity Explorer',
  description:
    'Browse the ERC-7730 clear-signing corpus: companies, contracts, and calls, with raw calldata beside its clear-signed decode.',
};

// Runs before first paint: resolve the persisted theme (or OS preference) and
// set data-theme on <html> so there is no flash of the wrong theme. Kept inline
// and dependency-free on purpose.
const NO_FLASH_SCRIPT = `(function(){try{var k='klarity-theme';var s=localStorage.getItem(k);var t=(s==='light'||s==='dark')?s:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      </head>
      <body>
        {/* The shared app shell mounts once here and persists across client-side
            navigation — only `children` (the page) swaps inside it. */}
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
