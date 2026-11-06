import type { ReactNode } from 'react';

export function NavLink({
  href,
  active = false,
  children,
}: {
  href: string;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <a className="bench-navlink" href={href} data-on={active ? 'true' : 'false'}>
      {children}
    </a>
  );
}
