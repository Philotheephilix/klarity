'use client';

import Link from 'next/link';
import { useState } from 'react';
import { DashboardShell } from '../components/DashboardShell';
import { ErrorCard, LoadingCard, useAsync } from '../components/States';
import {
  fetchDashboardVM,
  formatCount,
  type DashboardVM,
  type EntityStat,
  type StatusKey,
} from '../lib/dashboard';
import { IconArrowUpRight } from '../components/icons';
import { SyncStatusCard } from '../components/SyncStatusCard';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toasts';
import { useCountUp } from '../lib/useCountUp';
import { monogram, shortAddress } from '../lib/cardmeta';

export default function DashboardPage() {
  const state = useAsync(() => fetchDashboardVM(), []);

  return (
    <DashboardShell active="dashboard">
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
          <Link className="dash-btn dash-btn-ghost" href="/decode">
            API Docs
          </Link>
        </div>
      </div>

      {state.status === 'loading' ? <LoadingCard label="Loading dashboard" /> : null}
      {state.status === 'error' ? <ErrorCard error={state.error} /> : null}
      {state.status === 'ready' ? <DashboardBody vm={state.data} /> : null}
    </DashboardShell>
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

  // Modals wired to the list "New"/"Add" buttons (open/close + Escape handled
  // inside <Modal/>). Read-only app, so these are informational panels.
  const [modal, setModal] = useState<null | 'descriptors' | 'entities'>(null);

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

      {/* Middle row: analytics (wide) + featured + recent descriptors. */}
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

      {/* Bottom row: top entities + gauge + sync-status dark card. */}
      <section className="dash-grid-bot">
        <TopEntitiesCard entities={vm.perEntity} onAdd={() => setModal('entities')} />
        <GaugeCard vm={vm} />
        <SyncStatusCard />
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

      <Modal
        open={modal === 'entities'}
        title="Add an entity"
        onClose={() => setModal(null)}
      >
        <p className="dash-modal-text">
          Entities appear here automatically once the registry mirrors data for
          them. The explorer cannot add entities — browse the full registry to
          discover every mirrored corpus.
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

const STATUS_CYCLE: StatusKey[] = ['verified', 'pending', 'unverified'];
const STATUS_LABEL: Record<StatusKey, string> = {
  verified: 'Verified',
  pending: 'Pending',
  unverified: 'Unverified',
};

function TopEntitiesCard({
  entities,
  onAdd,
}: {
  entities: EntityStat[];
  onAdd: () => void;
}) {
  const toast = useToast();
  // Local UI state cycling the visible pill label — starts from the real
  // derived status for each entity (a demo of the interaction, not a data write).
  const [statuses, setStatuses] = useState<StatusKey[]>(() =>
    entities.map((e) => e.status),
  );

  function cycle(i: number) {
    setStatuses((prev) => {
      const next = [...prev];
      const idx = STATUS_CYCLE.indexOf(prev[i]);
      const nextStatus = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
      next[i] = nextStatus;
      toast.show(`${entities[i].displayName} → ${STATUS_LABEL[nextStatus]}`);
      return next;
    });
  }

  return (
    <div className="dash-card dash-top">
      <div className="dash-card-head">
        <h2 className="dash-card-title">Top Entities</h2>
        <button type="button" className="dash-mini-btn" onClick={onAdd}>
          Add
        </button>
      </div>
      <ul className="dash-rows">
        {entities.map((e, i) => (
          <li className="dash-row" key={e.entityName}>
            <span className="dash-row-ico" aria-hidden="true">
              {monogram(e.displayName)}
            </span>
            <span className="dash-row-text">
              <span className="dash-row-title">{e.displayName}</span>
              <span className="dash-row-sub">
                {formatCount(e.count, e.capped)} descriptors
              </span>
            </span>
            <button
              type="button"
              className="dash-pill"
              data-status={statuses[i]}
              onClick={() => cycle(i)}
              title="Click to cycle the displayed status"
            >
              {STATUS_LABEL[statuses[i]]}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Gauge segments derived from the real status split; clicking a legend item
// focuses that segment (updates centre percent + subtitle), a reskin of the
// comp's gauge-focus interaction.
interface GaugeSegment {
  key: StatusKey;
  label: string;
  count: number;
  pct: number;
}

function GaugeCard({ vm }: { vm: DashboardVM }) {
  const total = Math.max(
    1,
    vm.statusSplit.verified + vm.statusSplit.pending + vm.statusSplit.unverified,
  );
  const pctOf = (n: number) => Math.round((n / total) * 100);
  const segments: GaugeSegment[] = [
    {
      key: 'verified',
      label: 'Typed (verified)',
      count: vm.statusSplit.verified,
      pct: vm.verifiedPct,
    },
    {
      key: 'pending',
      label: 'Calldata (pending)',
      count: vm.statusSplit.pending,
      pct: pctOf(vm.statusSplit.pending),
    },
  ];

  // Default focus: the verified segment (matches the headline verifiedPct).
  const [focus, setFocus] = useState<GaugeSegment>(segments[0]);

  const r = 52;
  const arc = Math.PI * r;
  const filled = (focus.pct / 100) * arc;

  return (
    <div className="dash-card dash-gauge">
      <h2 className="dash-card-title">Verification</h2>
      <p className="dash-card-sub">Typed-data share (proxy)</p>
      <div className="dash-gauge-wrap">
        <svg viewBox="0 0 128 72" className="dash-gauge-svg" aria-hidden="true">
          <path
            d="M12 64 A52 52 0 0 1 116 64"
            fill="none"
            stroke="rgba(var(--ink-rgb),0.12)"
            strokeWidth="12"
            strokeLinecap="round"
          />
          <path
            d="M12 64 A52 52 0 0 1 116 64"
            fill="none"
            stroke={focus.key === 'pending' ? 'var(--dash-amber)' : 'var(--ok)'}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${arc}`}
          />
        </svg>
        <div className="dash-gauge-pct">
          <span className="dash-gauge-num">{focus.pct}%</span>
          <span className="dash-gauge-sub">{focus.label}</span>
        </div>
      </div>
      <ul className="dash-legend">
        {segments.map((s) => (
          <li key={s.key}>
            <button
              type="button"
              className="dash-legend-btn"
              data-on={focus.key === s.key ? 'true' : 'false'}
              onClick={() => setFocus(s)}
            >
              <span className="dash-dot" data-status={s.key} /> {s.label} · {s.count}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
