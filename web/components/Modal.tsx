'use client';

import { useEffect, type ReactNode } from 'react';

// Reusable modal — a reskin of the comp's add/new dialog pattern: backdrop
// blur, click-outside + Escape to close, open/close scale transition (driven by
// the `open` class). Themed entirely with Klarity tokens.

export function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <div
      className="dash-modal-backdrop"
      data-open={open ? 'true' : 'false'}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        className="dash-modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="dash-modal-head">
          <h3 className="dash-modal-title">{title}</h3>
          <button
            type="button"
            className="dash-modal-x"
            onClick={onClose}
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
