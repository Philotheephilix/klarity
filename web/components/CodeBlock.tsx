import type { ReactNode } from 'react';

export function CodeBlock({ children }: { children: ReactNode }) {
  return <pre className="code-block">{children}</pre>;
}

export function MonoLabel({ children }: { children: ReactNode }) {
  return <span className="mono">{children}</span>;
}
