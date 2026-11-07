'use client';

import type { ReactNode } from 'react';
import { monogram, sourceLabel, thumbStyle } from '../lib/cardmeta';
import { useBookmark } from './useBookmark';

export interface MetaPair {
  label: string;
  value: ReactNode;
}

/**
 * The rich explorer card shell shared by the company / contract / call grids.
 * Layout mirrors the "indomine Explore" marketplace card: a generated thumbnail
 * with a status badge (top-left) and a bookmark toggle (top-right), a bold
 * title + subtitle, a two-column metadata grid of real fields, and a
 * "listed by" footer with a monogram avatar. All visuals are generated from the
 * data (no external images). Read-only: the bookmark is the only toggle.
 */
export function RichCard({
  thumbKey,
  thumbName,
  status,
  statusTone = 'ok',
  bookmarkId,
  title,
  subtitle,
  meta,
  footerName,
  footerSource,
  onOpen,
}: {
  thumbKey: string;
  thumbName: string;
  status: string;
  statusTone?: 'ok' | 'pick' | 'guide' | 'muted';
  bookmarkId: string;
  title: ReactNode;
  subtitle: ReactNode;
  meta: MetaPair[];
  footerName: string;
  footerSource: string;
  onOpen?: () => void;
}) {
  const [marked, toggleMark] = useBookmark(bookmarkId);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen?.();
    }
  }

  return (
    <article
      className="rich-card bench-card"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={handleKey}
    >
      <div className="rich-thumb" style={thumbStyle(thumbKey)}>
        <span className="rich-thumb-mono" aria-hidden="true">
          {monogram(thumbName)}
        </span>
        <span className="rich-status" data-tone={statusTone}>
          {status}
        </span>
        <button
          type="button"
          className="rich-bookmark"
          data-on={marked ? 'true' : 'false'}
          aria-pressed={marked}
          aria-label={marked ? 'Remove bookmark' : 'Add bookmark'}
          title={marked ? 'Remove bookmark' : 'Add bookmark'}
          onClick={(e) => {
            e.stopPropagation();
            toggleMark();
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill={marked ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      </div>

      <div className="rich-body">
        <div className="rich-head">
          <div className="rich-title">{title}</div>
          <div className="rich-sub mono">{subtitle}</div>
        </div>

        <dl className="rich-meta">
          {meta.map((m) => (
            <div className="rich-meta-cell" key={m.label}>
              <dt className="rich-meta-label">{m.label}</dt>
              <dd className="rich-meta-value">{m.value}</dd>
            </div>
          ))}
        </dl>

        <div className="rich-foot">
          <span className="rich-avatar" aria-hidden="true">
            {monogram(footerName)}
          </span>
          <span className="rich-foot-text">
            <span className="rich-foot-by">listed by {footerName}</span>
            <span className="rich-foot-src mono">{sourceLabel(footerSource)}</span>
          </span>
        </div>
      </div>
    </article>
  );
}
