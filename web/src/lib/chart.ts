export const PALETTE = {
  pv: '#f5a524',
  load: '#38bdf8',
  gridImport: '#ef4444',
  gridExport: '#22c55e',
  charge: '#38bdf8',
  discharge: '#a78bfa',
  generator: '#fb923c',
  bess: '#a78bfa',
  co2: '#4ade80',
  savings: '#2dd4bf',
  neutral: '#64748b',
};

export const SERIES = [PALETTE.pv, PALETTE.load, PALETTE.gridImport, PALETTE.gridExport, PALETTE.discharge, PALETTE.generator, '#f472b6', '#facc15'];

export const AXIS = {
  stroke: '#456078',
  tick: { fill: '#8aa2b8', fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: '#203346' },
};

export const GRID = { stroke: '#152636', strokeDasharray: '3 4', vertical: false };

export const TOOLTIP = {
  contentStyle: { background: '#0b1a28', border: '1px solid #1f3a4f', borderRadius: 8, fontSize: 12, color: '#e6f1fb' },
  labelStyle: { color: '#cfe6f7', fontWeight: 600 },
  itemStyle: { color: '#cfe6f7' },
  cursor: { fill: 'rgba(56,189,248,0.06)' },
};

export const LEGEND = { wrapperStyle: { fontSize: 11, color: '#8aa2b8' }, iconSize: 9 };

export function shortTick(value: string): string {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}/.test(value)) return value.slice(11, 16);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.slice(5);
  return value;
}
