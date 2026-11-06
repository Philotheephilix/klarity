import type { ReactNode } from 'react';

export function Chip({
  label,
  active = false,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className="bench-chip"
      data-on={active ? 'true' : 'false'}
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function TagChip({ children }: { children: ReactNode }) {
  return <span className="ctx-chip">{children}</span>;
}
