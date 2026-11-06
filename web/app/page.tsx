'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ErrorCard, LoadingCard, useAsync } from '../components/States';
import {
  fetchDashboardVM,
  formatCount,
  type DashboardVM,
} from '../lib/dashboard';
import { IconArrowUpRight } from '../components/icons';
import { Modal } from '../components/Modal';
import { useCountUp } from '../lib/useCountUp';
import { monogram, shortAddress } from '../lib/cardmeta';

export default function DashboardPage() {
  const state = useAsync(() => fetchDashboardVM(), []);

  return (
    <>
      <div className="dash-head">
        <div>
          <h1 className="dash-title">Dashboard</h1>
          <p className="dash-subtitle">
            A read-only view of the ERC-7730 clear-signing registry: descriptors,
            entities, contracts and chains at a glance.
          </p>
        </div>
        <div className="dash-head-actions">
          <Link className="dash-btn dash-btn-primary" href="/browse">
            Browse Registry
          </Link>
          <Link className="dash-btn dash-btn-ghost" href="/docs">
            API Docs
          </Link>
        </div>
      </div>

      {state.status === 'loading' ? <LoadingCard label="Loading dashboard" /> : null}
      {state.status === 'error' ? <ErrorCard error={state.error} /> : null}
      {state.status === 'ready' ? <DashboardBody vm={state.data} /> : null}
    </>
  );
}

// Split a formatted count like "100+" into its numeric part and suffix so the
// count-up animation ticks the number and keeps the honest "+" cap marker.
function splitCount(formatted: string): { num: number; suffix: string } {
  const m = formatted.match(/^(\d+)(.*)$/);
  if (!m) return { num: 0, suffix: formatted };
  return { num: Number(m[1]), suffix: m[2] };
}

function StatTile({
  label,
  value,
  note,
  active = false,
}: {
  label: string;
  value: string;
  note: string;
  active?: boolean;
}) {
  // Count up to the real number on mount; append the cap suffix (e.g. "+").
  const { num, suffix } = splitCount(value);
  const shown = useCountUp(num);
  return (
    <div className="dash-stat" data-active={active ? 'true' : 'false'}>
      <div className="dash-stat-top">
        <span className="dash-stat-label">{label}</span>
        <span className="dash-stat-arrow" aria-hidden="true">
          <IconArrowUpRight size={16} />
        </span>
      </div>
      <div className="dash-stat-value">
        {shown}
        {suffix}
      </div>
      <div className="dash-stat-foot">
        <span className="dash-stat-badge">registry</span>
        <span className="dash-stat-note">{note}</span>
      </div>
    </div>
  );
}

function DashboardBody({ vm }: { vm: DashboardVM }) {
  const featured = vm.perEntity.find((e) => e.count > 0) ?? vm.perEntity[0];
  const maxChain = Math.max(1, ...vm.perChain.map((c) => c.count));

  // Analytics bar selection: start on the busiest chain (index 0) and surface
  // its real count in the hint line + the floating tooltip.
  const [selectedChain, setSelectedChain] = useState(0);

  // Modal wired to the Descriptors list "New" button (open/close + Escape
  // handled inside <Modal/>). Read-only app, so this is an informational panel.
  const [modal, setModal] = useState<null | 'descriptors'>(null);

  const selected = vm.perChain[selectedChain];

  return (
    <>
      {/* KPI tiles — all numbers derived from live API rows; count-up on mount. */}
      <section className="dash-stats" aria-label="Key metrics">
        <StatTile
          label="Total Descriptors"
          value={formatCount(vm.totalDescriptors, vm.totalCapped)}
          note="across featured entities"
          active
        />
        <StatTile
          label="Entities"
          value={String(vm.entitiesWithData)}
          note="with mirrored data"
        />
        <StatTile
          label="Contracts"
          value={String(vm.distinctContracts)}
          note="distinct addresses"
        />
        <StatTile
          label="Chains"
          value={String(vm.distinctChains)}
          note="networks covered"
        />
      </section>

      {/* Middle row: analytics (wide) + featured entity. */}
      <section className="dash-grid-mid">
        <div className="dash-card dash-analytics">
          <div className="dash-card-head">
            <div>
              <h2 className="dash-card-title">Registry Analytics</h2>
              <p className="dash-card-sub">Descriptors per chain</p>
            </div>
            <span className="dash-analytics-hint" data-testid="analytics-hint">
              {selected
                ? `${selected.label}: ${formatCount(selected.count, selected.capped)} descriptors`
                : 'No chain data'}
            </span>
          </div>
          <div className="dash-chart" role="img" aria-label="Descriptors per chain bar chart">
            {vm.perChain.map((c, i) => {
              const h = Math.round((c.count / maxChain) * 100);
              const hot = i < 2; // highlight the two busiest chains
              const isSelected = i === selectedChain;
              return (
                <button
                  type="button"
                  className="dash-bar-col"
                  key={c.key}
                  data-selected={isSelected ? 'true' : 'false'}
                  onClick={() => setSelectedChain(i)}
                  aria-pressed={isSelected}
                  aria-label={`${c.label}: ${formatCount(c.count, c.capped)} descriptors`}
                >
                  <div className="dash-bar-wrap">
                    {isSelected ? (
                      <span className="dash-bar-tooltip" data-testid="bar-tooltip">
                        {formatCount(c.count, c.capped)}
                      </span>
                    ) : null}
                    <div
                      className="dash-bar"
                      data-hot={hot ? 'true' : 'false'}
                      /* Grow from 0 via CSS keyframe; CSS var carries target. */
                      style={
                        {
                          ['--bar-h' as string]: `${Math.max(6, h)}%`,
                          animationDelay: `${90 + i * 55}ms`,
                        } as React.CSSProperties
                      }
                    />
                  </div>
                  <span className="dash-bar-label">{c.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="dash-card dash-featured">
          <h2 className="dash-card-title">Featured Entity</h2>
          <p className="dash-card-sub">Latest mirrored corpus</p>
          <div className="dash-featured-body">
            <span className="dash-featured-mono" aria-hidden="true">
              {monogram(featured.displayName)}
            </span>
            <div className="dash-featured-name">{featured.displayName}</div>
            <div className="dash-featured-meta">
              {formatCount(featured.count, featured.capped)} descriptors mirrored
            </div>
          </div>
          <Link className="dash-btn dash-btn-primary dash-featured-cta" href={`/${featured.entityName}`}>
            View
          </Link>
        </div>
      </section>

      {/* Bottom: the full-width Descriptors list. */}
      <section className="dash-grid-bot">
        <div className="dash-card dash-list">
          <div className="dash-card-head">
            <h2 className="dash-card-title">Descriptors</h2>
            <button
              type="button"
              className="dash-mini-btn"
              title="About the descriptors list"
              onClick={() => setModal('descriptors')}
            >
              New
            </button>
          </div>
          <ul className="dash-rows">
            {vm.recent.map((r, i) => (
              <li className="dash-row" key={`${r.chainId}:${r.contract}:${r.selector}:${i}`}>
                <span className="dash-row-ico" aria-hidden="true">
                  {monogram(r.functionName || r.contractName || r.entityName)}
                </span>
                <span className="dash-row-text">
                  <span className="dash-row-title">
                    {r.functionName || r.intent || r.selector}
                  </span>
                  <span className="dash-row-sub">
                    {r.entityName} · {shortAddress(r.contract)}
                  </span>
                </span>
                <span className="dash-row-kind" data-kind={r.kind}>
                  {r.kind}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <Modal
        open={modal === 'descriptors'}
        title="Browse descriptors"
        onClose={() => setModal(null)}
      >
        <p className="dash-modal-text">
          This is a read-only explorer — descriptors are mirrored from the
          ERC-7730 registry and cannot be created here. Open the full list to
          inspect every mirrored descriptor.
        </p>
        <div className="dash-modal-actions">
          <button type="button" className="dash-btn dash-btn-ghost" onClick={() => setModal(null)}>
            Close
          </button>
          <Link className="dash-btn dash-btn-primary" href="/browse">
            Browse Registry
          </Link>
        </div>
      </Modal>
    </>
  );
}
