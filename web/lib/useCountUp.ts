'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Count up from 0 to `target` on mount, mirroring the reference comp's KPI
 * count-up. Returns the current integer. For capped values the caller appends a
 * "+": we count the numeric part only. Respects prefers-reduced-motion by
 * jumping straight to the target.
 */
export function useCountUp(target: number, durationMs = 680): number {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (target <= 0) {
      setValue(0);
      return;
    }
    const reduce =
      typeof window === 'undefined' ||
      typeof window.requestAnimationFrame !== 'function' ||
      !window.matchMedia ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setValue(target);
      return;
    }

    const start = performance.now();
    function tick(now: number) {
      const t = Math.min(1, (now - start) / durationMs);
      // easeOutCubic for the same "settle" feel as the comp.
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(eased * target));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setValue(target);
      }
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, durationMs]);

  return value;
}
