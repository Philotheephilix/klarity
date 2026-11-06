'use client';

import { useEffect, useRef, useState } from 'react';
import { IconPause, IconPlay, IconStop } from './icons';

function format(totalSecs: number): string {
  const h = String(Math.floor(totalSecs / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSecs % 3600) / 60)).padStart(2, '0');
  const s = String(totalSecs % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/**
 * Always-dark "Sync Status" card — a reskin of a time-tracker. Shows elapsed
 * time since mount (HH:MM:SS) with play/pause + stop controls. This is the one
 * interactive widget on the dashboard; it drives nothing but its own timer.
 */
export function SyncStatusCard() {
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(true);
  const runningRef = useRef(running);
  runningRef.current = running;

  useEffect(() => {
    const id = setInterval(() => {
      if (runningRef.current) setSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="dash-card dash-sync">
      <svg
        className="dash-sync-art"
        viewBox="0 0 280 180"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="klSyncBase" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#05170e" />
            <stop offset="0.55" stopColor="#0b2d1b" />
            <stop offset="1" stopColor="#061b10" />
          </linearGradient>
          <linearGradient id="klSyncWave" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#11462b" stopOpacity="0.9" />
            <stop offset="0.5" stopColor="#237a4d" stopOpacity="0.7" />
            <stop offset="1" stopColor="#0b2e1c" stopOpacity="0.9" />
          </linearGradient>
        </defs>
        <rect width="280" height="180" fill="url(#klSyncBase)" />
        <path
          d="M-20 170 C50 155, 110 110, 160 50 C195 8, 240 -10, 295 10 L295 190 L-20 190 Z"
          fill="url(#klSyncWave)"
        />
        <g stroke="#3da36d" strokeOpacity="0.3" fill="none" strokeWidth="1.2">
          <path d="M135 -10 C150 35, 200 65, 290 45" />
          <path d="M-15 175 C65 165, 145 125, 290 95" />
          <path d="M20 192 C105 182, 180 152, 290 128" />
        </g>
      </svg>

      <div className="dash-sync-head">
        <span className="dash-sync-title">Sync Status</span>
        <span
          className="dash-sync-dot"
          data-on={running ? 'true' : 'false'}
          title={running ? 'Syncing' : 'Paused'}
        />
      </div>

      <div className="dash-sync-digits">{format(seconds)}</div>

      <div className="dash-sync-controls">
        <button
          type="button"
          className="dash-timer-btn dash-timer-main"
          onClick={() => setRunning((r) => !r)}
          aria-label={running ? 'Pause timer' : 'Resume timer'}
          title={running ? 'Pause' : 'Resume'}
        >
          {running ? <IconPause size={16} /> : <IconPlay size={16} />}
        </button>
        <button
          type="button"
          className="dash-timer-btn dash-timer-stop"
          onClick={() => {
            setRunning(false);
            setSeconds(0);
          }}
          aria-label="Stop and reset timer"
          title="Stop"
        >
          <IconStop size={15} />
        </button>
      </div>
    </div>
  );
}
