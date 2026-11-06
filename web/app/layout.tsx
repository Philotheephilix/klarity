import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Klarity Explorer',
  description:
    'Browse the ERC-7730 clear-signing corpus: companies, contracts, and calls, with raw calldata beside its clear-signed decode.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <body>{children}</body>
    </html>
  );
}
