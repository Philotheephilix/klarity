'use client';

import { useCallback, useEffect, useState } from 'react';

const BOOKMARK_KEY = 'klarity-bookmarks';

function readBookmarks(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(BOOKMARK_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed.filter((v): v is string => typeof v === 'string'));
  } catch {
    // ignore corrupt / unavailable storage
  }
  return new Set();
}

/**
 * Presentational-but-persisted bookmark toggle state, keyed by a stable id.
 * Falls back gracefully when localStorage is unavailable.
 */
export function useBookmark(id: string): [boolean, () => void] {
  const [marked, setMarked] = useState(false);

  useEffect(() => {
    setMarked(readBookmarks().has(id));
  }, [id]);

  const toggle = useCallback(() => {
    setMarked((prev) => {
      const next = !prev;
      try {
        const set = readBookmarks();
        if (next) set.add(id);
        else set.delete(id);
        window.localStorage.setItem(BOOKMARK_KEY, JSON.stringify([...set]));
      } catch {
        // ignore persistence failures
      }
      return next;
    });
  }, [id]);

  return [marked, toggle];
}
