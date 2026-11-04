import React from 'react';
import { cn, num, power, pct } from '../lib/format';

export interface FlowNodes {
  pv?: { kw?: number | null; status?: string; capacityKwp?: number; utilPct?: number | null };
  grid?: { kw?: number | null; direction?: string; status?: string; voltageV?: number | null; frequencyHz?: number | null; importKw?: number | null; exportKw?: number | null };
  bess?: { kw?: number | null; direction?: string; status?: string; socPct?: number | null; sohPct?: number | null; temperatureC?: number | null; capacityKwh?: number };
  generator?: { kw?: number | null; status?: string; fuelLevelPct?: number | null; capacityKw?: number | null };
  load?: { kw?: number | null; status?: string; powerFactor?: number | null };
}

const COLORS = {
  pv: '#f5a524', gridImport: '#ef4444', gridExport: '#22c55e', bessCharge: '#38bdf8',
  bessDischarge: '#a78bfa', generator: '#fb923c', load: '#dbe7f3', missing: '#475569',
};

function FlowPath({ d, color, active, reverse, id }: { d: string; color: string; active: boolean; reverse?: boolean; id: string }) {
  return (
    <g opacity={active ? 1 : 0.32}>
      <path d={d} fill="none" stroke={active ? color : COLORS.missing} strokeWidth={active ? 7 : 3} strokeLinecap="round" opacity={0.12} />
      <path d={d} fill="none" stroke={active ? color : COLORS.missing} strokeWidth={active ? 1.6 : 1} strokeDasharray={active ? undefined : '5 7'} strokeLinecap="round" />
      {active && [0, 1, 2].map((i) => (
        <circle key={i} r={3.2} fill={color} opacity={0.95}>
          <animateMotion dur="1.8s" repeatCount="indefinite" begin={`${(i * 0.6).toFixed(1)}s`} keyPoints={reverse ? '1;0' : '0;1'} keyTimes="0;1" path={d} />
        </circle>
      ))}
      <title>{id}</title>
    </g>
  );
}

function NodeBox({ x, y, width = 150, height = 64, label, value, sub, color, status, icon }: {
  x: number; y: number; width?: number; height?: number; label: string; value: string; sub?: string;
  color: string; status?: string; icon: string;
}) {
  const missing = !value || value === '—';
  return (
    <g className={`flow-node flow-node-${label.toLowerCase().replace(/\s+/g, '-')}`} transform={`translate(${x},${y})`}>
      <rect width={width} height={height} rx={10} fill="var(--flow-node-bg)" stroke={missing ? COLORS.missing : color} strokeWidth={1.2} opacity={missing ? 0.7 : 1} />
      <rect width={4} height={height} rx={2} fill={missing ? COLORS.missing : color} />
      <text x={16} y={20} fill={missing ? 'var(--flow-muted)' : color} fontSize={10} letterSpacing={1.1} fontWeight={700}>{icon} {label.toUpperCase()}</text>
      <text x={16} y={43} fill={missing ? 'var(--flow-muted)' : 'var(--flow-text)'} fontSize={18} fontWeight={700}>{missing ? 'NO DATA' : value}</text>
      {sub && <text x={16} y={56} fill="var(--flow-subtext)" fontSize={9}>{sub}</text>}
      {status && <circle cx={width - 14} cy={14} r={4} fill={missing ? COLORS.missing : color}><animate attributeName="opacity" values="1;0.35;1" dur="2s" repeatCount="indefinite" /></circle>}
    </g>
  );
}

export function EnergyFlow({ nodes, ts, stale, className, compact }: { nodes: FlowNodes; ts?: string | null; stale?: boolean; className?: string; compact?: boolean }) {
  const pv = Number(nodes.pv?.kw) || 0;
  const load = Number(nodes.load?.kw) || 0;
  const grid = Number(nodes.grid?.kw) || 0;
  const gridDir = nodes.grid?.direction || (grid > 0.01 ? 'IMPORT' : grid < -0.01 ? 'EXPORT' : 'IDLE');
  const bess = Number(nodes.bess?.kw) || 0;
  const bessDir = nodes.bess?.direction || (bess > 0.01 ? 'DISCHARGING' : bess < -0.01 ? 'CHARGING' : 'IDLE');
  const gen = Number(nodes.generator?.kw) || 0;
  const gridMissing = nodes.grid?.kw == null || nodes.grid?.status === 'NO_DATA';
  const pvMissing = nodes.pv?.kw == null;
  const bessMissing = nodes.bess?.kw == null;
  const genMissing = nodes.generator?.kw == null && nodes.generator?.status !== 'NOT_INSTALLED';
  const loadMissing = nodes.load?.kw == null;

  const pvActive = !pvMissing && pv > 0.5;
  const gridImportActive = !gridMissing && gridDir === 'IMPORT' && grid > 0.5;
  const gridExportActive = !gridMissing && gridDir === 'EXPORT' && grid > 0.5;
  const bessDischargeActive = !bessMissing && bessDir === 'DISCHARGING' && bess > 0.5;
  const bessChargeActive = !bessMissing && bessDir === 'CHARGING' && bess > 0.5;
  const genActive = !genMissing && gen > 0.5;

  const pvPath = 'M 190 115 Q 330 112 415 196';
  const gridPath = 'M 190 235 L 405 214';
  const genPath = 'M 190 360 Q 320 355 405 240';
  const bessPath = 'M 470 360 Q 470 285 425 235';
  const trunk = 'M 415 210 L 665 210';

  return (
    <div className={cn('energy-flow', compact && 'compact', className)}>
      <svg viewBox="0 0 900 430" role="img" aria-label="Live single-line energy flow diagram">
        <defs>
          <linearGradient id="trunkGradient" x1="0" x2="1">
            <stop offset="0" stopColor={COLORS.pv} />
            <stop offset="0.5" stopColor={COLORS.gridExport} />
            <stop offset="1" stopColor={COLORS.load} />
          </linearGradient>
        </defs>

        <FlowPath id="PV to load" d={pvPath} color={COLORS.pv} active={pvActive} />
        <FlowPath id="Grid to load (import)" d={gridPath} color={COLORS.gridImport} active={gridImportActive} />
        <FlowPath id="Load to grid (export)" d={gridPath} color={COLORS.gridExport} active={gridExportActive} reverse />
        <FlowPath id="Generator to load" d={genPath} color={COLORS.generator} active={genActive} />
        <FlowPath id="Battery discharge" d={bessPath} color={COLORS.bessDischarge} active={bessDischargeActive} reverse={false} />
        <FlowPath id="Battery charge" d={bessPath} color={COLORS.bessCharge} active={bessChargeActive} reverse />

        <path d={trunk} fill="none" stroke="url(#trunkGradient)" strokeWidth={2.5} opacity={0.5} />
        {loadMissing && <path d={trunk} fill="none" stroke={COLORS.missing} strokeWidth={1} strokeDasharray="5 7" />}

        <circle cx={415} cy={210} r={7} fill="var(--flow-node-bg)" stroke="#38bdf8" strokeWidth={2} />
        <circle cx={415} cy={210} r={2.5} fill="#38bdf8" />

        <NodeBox x={40} y={78} label="Solar PV" color={COLORS.pv} icon="☀"
          value={pvMissing ? '—' : power(Math.abs(pv))}
          sub={nodes.pv?.capacityKwp ? `${num(nodes.pv.capacityKwp, 0)} kWp · ${pct(nodes.pv.utilPct)} util.` : 'Array field'} />
        <NodeBox x={40} y={198} label="PLN Grid" color={gridDir === 'EXPORT' ? COLORS.gridExport : COLORS.gridImport} icon="⚡"
          value={gridMissing ? '—' : power(Math.abs(grid))}
          sub={gridMissing ? 'Meter offline' : `${gridDir} · ${num(nodes.grid?.frequencyHz, 2)} Hz`} />
        <NodeBox x={40} y={323} label="Generator" color={COLORS.generator} icon="⚙"
          value={nodes.generator?.status === 'NOT_INSTALLED' ? 'N/A' : genMissing ? '—' : power(Math.abs(gen))}
          sub={nodes.generator?.status === 'NOT_INSTALLED' ? 'Not installed' : `${nodes.generator?.status || '—'} · fuel ${pct(nodes.generator?.fuelLevelPct, 0)}`} />
        <NodeBox x={420} y={323} width={165} label="BESS" color={bessDir === 'CHARGING' ? COLORS.bessCharge : COLORS.bessDischarge} icon="▤"
          value={bessMissing ? '—' : power(Math.abs(bess))}
          sub={bessMissing ? 'BMS no data' : `${bessDir} · SOC ${pct(nodes.bess?.socPct)}`} />
        <NodeBox x={665} y={178} width={195} label="Plant Load" color={COLORS.load} icon="⌂"
          value={loadMissing ? '—' : power(load)}
          sub={loadMissing ? 'Load meter offline' : `PF ${num(nodes.load?.powerFactor, 2)} · ${nodes.load?.status || 'SUPPLIED'}`} />

        {stale && (
          <g transform="translate(660,40)">
            <rect width={200} height={26} rx={6} fill="var(--flow-stale-bg)" stroke="#ef4444" />
            <text x={10} y={17} fill="var(--flow-stale-text)" fontSize={10} fontWeight={700}>STALE TELEMETRY — LAST KNOWN VALUES</text>
          </g>
        )}
        <text x={40} y={412} fill="var(--flow-subtext)" fontSize={9}>
          {ts ? `Last update ${new Date(ts).toLocaleTimeString('en-GB')}` : 'No telemetry timestamp'}
        </text>
        <text x={700} y={412} fill="var(--flow-subtext)" fontSize={9} textAnchor="end">Read-only monitoring · no remote control</text>
      </svg>
      <div className="flow-legend">
        <span><i style={{ background: COLORS.pv }} />PV</span>
        <span><i style={{ background: COLORS.gridImport }} />Grid import</span>
        <span><i style={{ background: COLORS.gridExport }} />Grid export</span>
        <span><i style={{ background: COLORS.bessCharge }} />BESS charge</span>
        <span><i style={{ background: COLORS.bessDischarge }} />BESS discharge</span>
        <span><i style={{ background: COLORS.generator }} />Generator</span>
        <span><i style={{ background: COLORS.missing }} />Missing data</span>
      </div>
    </div>
  );
}
