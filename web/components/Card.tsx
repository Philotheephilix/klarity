import type { ReactNode } from 'react';

export function Card({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <article className="bench-card" onClick={onClick}>
      {children}
    </article>
  );
}
