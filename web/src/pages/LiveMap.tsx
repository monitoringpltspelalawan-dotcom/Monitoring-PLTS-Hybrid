import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { geoMercator, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import worldData from 'world-atlas/countries-110m.json';
import { MapPin, Search, Sun, BatteryCharging, Gauge, Radio, ArrowUpRight, Layers } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui';
import { useAsync, useSites } from '../lib/hooks';
import { get, qs } from '../lib/api';
import { useRealtime } from '../lib/ws';
import { cn, energy, num, pct, power, statusColor, timeAgo } from '../lib/format';

interface MapSite {
  id: string; code: string; name: string; regionId: string; regionName: string; status: string;
  latitude: number; longitude: number; pvCapacityKwp: number; bessCapacityKwh: number;
  live: any; alarmCount: number; dataSource: string; location?: string;
}

const MAP_W = 940;
const MAP_H = 520;

function buildMap() {
  const topo: any = worldData;
  const countries: any = feature(topo, topo.objects.countries);
  const projection = geoMercator().center([121, -4]).scale(1250).translate([MAP_W / 2, MAP_H / 2]);
  const path = geoPath(projection);
  return { countries, projection, path };
}

export default function LiveMap() {
  const navigate = useNavigate();
  const sitesState = useSites();
  const { sites: liveMap, connected } = useRealtime();
  const [region, setRegion] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const mapGeo = useMemo(buildMap, []);

  const allSites = (sitesState.data?.sites || []) as unknown as MapSite[];
  const regions = useMemo(() => [...new Map(allSites.map((s) => [s.regionId, s.regionName])).entries()], [allSites]);

  const sites = useMemo(() => allSites.filter((s) => {
    if (region && s.regionId !== region) return false;
    if (status && s.status !== status) return false;
    if (search && !`${s.code} ${s.name} ${s.location || ''}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [allSites, region, status, search]);

  const focused = sites.find((s) => s.id === (selected || hover)) || null;
  const liveOf = (site: MapSite) => liveMap.get(site.id) || site.live || null;

  const mapAlarms = sitesState.data;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Geospatial operations"
        title="Live site map"
        subtitle="Offline vector map of the Indonesian archipelago. Markers reflect last-known telemetry, connectivity and active alarms."
        actions={<>
          <Badge color={connected ? 'var(--good)' : 'var(--critical)'} dot>{connected ? 'LIVE STREAM' : 'STREAM OFFLINE'}</Badge>
          <Badge color="var(--accent)" dot>OFFLINE MAP</Badge>
        </>}
      />

      <div className="filter-bar">
        <select className="input" value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Region filter">
          <option value="">All regions ({regions.length})</option>
          {regions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
          <option value="">Any status</option>
          {['ONLINE', 'WARNING', 'CRITICAL', 'MAINTENANCE', 'OFFLINE'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="search grow"><Search size={14} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a site on the map…" /></label>
        <span className="filter-meta"><Layers size={14} /> {sites.length} of {allSites.length} sites</span>
      </div>

      {sitesState.error && <ErrorState error={sitesState.error} onRetry={sitesState.reload} />}
      {sitesState.loading && !sitesState.data && <Spinner label="Loading geospatial site data…" />}

      <div className="grid map-layout">
        <Card noPad className="map-card">
          <div className="map-shell">
            <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="world-map" role="img" aria-label="Map of monitored PLTS sites in Indonesia">
              <defs>
                <radialGradient id="mapGlow" cx="50%" cy="50%" r="60%">
                  <stop offset="0%" stopColor="var(--map-glow)" stopOpacity="var(--map-glow-opacity)" />
                  <stop offset="100%" stopColor="#050b12" stopOpacity="0" />
                </radialGradient>
              </defs>
              <rect width={MAP_W} height={MAP_H} fill="var(--map-surface)" />
              <ellipse cx={MAP_W * 0.56} cy={MAP_H * 0.55} rx={320} ry={220} fill="url(#mapGlow)" />
              <g className="map-countries">
                {mapGeo.countries.features.map((f: any, i: number) => (
                  <path key={f.id || i} d={mapGeo.path(f) || ''} />
                ))}
              </g>
              <g className="map-graticule">
                {[-10, -5, 0, 5, 10].map((lat) => {
                  const p1 = mapGeo.projection([95, lat]);
                  const p2 = mapGeo.projection([141, lat]);
                  return p1 && p2 ? <line key={lat} x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} /> : null;
                })}
                {[100, 110, 120, 130, 140].map((lon) => {
                  const p1 = mapGeo.projection([lon, -12]);
                  const p2 = mapGeo.projection([lon, 8]);
                  return p1 && p2 ? <line key={lon} x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} /> : null;
                })}
              </g>
              {sites.map((s) => {
                const point = mapGeo.projection([s.longitude, s.latitude]);
                if (!point) return null;
                const [x, y] = point;
                const live = liveOf(s);
                const color = statusColor(s.status === 'ONLINE' && live?.stale ? 'OFFLINE' : s.status);
                const r = 5 + Math.sqrt(Math.max(40, s.pvCapacityKwp)) / 8;
                const isActive = (selected || hover) === s.id;
                return (
                  <g
                    key={s.id}
                    className={cn('map-marker', isActive && 'active')}
                    transform={`translate(${x},${y})`}
                    onMouseEnter={() => setHover(s.id)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => setSelected(s.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') setSelected(s.id); }}
                  >
                    {s.status !== 'OFFLINE' && <circle r={r + 9} fill={color} opacity={0.13} className="map-pulse" />}
                    <circle r={r + 3} fill="none" stroke={color} strokeWidth={1} opacity={0.45} />
                    <circle r={r} fill={color} fillOpacity={0.88} stroke="#07111c" strokeWidth={1.4} />
                    {s.alarmCount > 0 && <circle r={3.2} cx={r - 1} cy={-r + 1} fill="#ef4444" stroke="#07111c" strokeWidth={0.8} />}
                    {(isActive || s.pvCapacityKwp >= 280) && (
                      <g className="map-label" transform={`translate(${r + 7},${3})`}>
                        <rect x={0} y={-9} width={Math.max(58, s.code.length * 6.4)} height={17} rx={3} />
                        <text x={4} y={3}>{s.code.replace('PLTS-', '')}</text>
                      </g>
                    )}
                  </g>
                );
              })}
              <g className="map-legend">
                <rect x={16} y={MAP_H - 78} width={232} height={62} rx={7} />
                {[
                  ['ONLINE', 'var(--good)'], ['WARNING', 'var(--warning)'], ['CRITICAL', 'var(--critical)'], ['OFFLINE', 'var(--muted)'],
                ].map(([label, color], i) => (
                  <g key={label} transform={`translate(${30 + (i % 2) * 108},${MAP_H - 62 + Math.floor(i / 2) * 18})`}>
                    <circle r={4} fill={color} />
                    <text x={10} y={3.5}>{label}</text>
                  </g>
                ))}
              </g>
              <text x={MAP_W - 18} y={MAP_H - 20} textAnchor="end" className="map-credit">Vector basemap: Natural Earth · no external tiles</text>
            </svg>

            {!sites.length && !sitesState.loading && (
              <div className="map-empty"><MapPin size={20} /><strong>No sites match the filter</strong><span>Reset the region, status or search filters.</span></div>
            )}

            <div className="map-tooltip" style={{ display: focused ? 'block' : 'none' }}>
              {focused && (() => {
                const live = liveOf(focused);
                return (
                  <>
                    <div className="map-tooltip-head">
                      <div><strong>{focused.code}</strong><span>{focused.name}</span></div>
                      <Badge status={focused.status}>{focused.status}</Badge>
                    </div>
                    <div className="map-tooltip-grid">
                      <div><Sun size={12} /><span>PV</span><strong>{power(live?.pv?.powerKw)}</strong></div>
                      <div><BatteryCharging size={12} /><span>SOC</span><strong>{pct(live?.bess?.socPct, 0)}</strong></div>
                      <div><Gauge size={12} /><span>Load</span><strong>{power(live?.load?.powerKw)}</strong></div>
                    </div>
                    <div className="map-tooltip-foot">
                      <span>{focused.regionName} · {num(focused.pvCapacityKwp, 0)} kWp</span>
                      <Button size="sm" variant="primary" icon={<ArrowUpRight size={12} />} onClick={() => navigate(`/sites/${focused.id}`)}>Open</Button>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </Card>

        <div className="map-side">
          <Card
            title="Sites in view"
            subtitle={`${sites.length} plants · sorted by capacity`}
            actions={<span className="live-chip on"><Radio size={11} /> {connected ? 'LIVE' : 'CACHE'}</span>}
            noPad
          >
            <div className="map-site-list">
              {[...sites].sort((a, b) => b.pvCapacityKwp - a.pvCapacityKwp).map((s) => {
                const live = liveOf(s);
                return (
                  <button
                    key={s.id}
                    className={cn('map-site-row', (selected || hover) === s.id && 'active')}
                    onClick={() => setSelected(s.id)}
                    onDoubleClick={() => navigate(`/sites/${s.id}`)}
                  >
                    <span className="map-site-dot" style={{ background: statusColor(s.status) }} />
                    <div className="map-site-main">
                      <strong>{s.code}</strong>
                      <small>{s.regionName} · {num(s.pvCapacityKwp, 0)} kWp</small>
                    </div>
                    <div className="map-site-live">
                      <span className="mono">{power(live?.pv?.powerKw ?? 0)}</span>
                      <small>{pct(live?.bess?.socPct, 0)} SOC</small>
                    </div>
                  </button>
                );
              })}
              {!sites.length && <EmptyState title="No sites" message="No plant matches the current filters." />}
            </div>
          </Card>

          {focused && (() => {
            const live = liveOf(focused);
            return (
              <Card title="Selected plant" subtitle={focused.location} actions={<Badge status={focused.status}>{focused.status}</Badge>}>
                <div className="selected-site">
                  <div className="selected-site-head">
                    <strong>{focused.name}</strong>
                    <span>{focused.code} · {focused.regionName}</span>
                  </div>
                  <div className="selected-kpis">
                    <div><span>PV now</span><strong>{power(live?.pv?.powerKw)}</strong></div>
                    <div><span>Load</span><strong>{power(live?.load?.powerKw)}</strong></div>
                    <div><span>SOC</span><strong>{pct(live?.bess?.socPct, 0)}</strong></div>
                    <div><span>PV today</span><strong>{energy(focused.live?.pvTodayKwh)}</strong></div>
                  </div>
                  <div className="selected-meta">
                    <span>Last seen <strong>{timeAgo(live?.lastSeenAt)}</strong></span>
                    <span>Source <strong className="source-tag demo">{focused.dataSource}</strong></span>
                    <span>Alarms <strong>{focused.alarmCount || 0}</strong></span>
                  </div>
                  <Button variant="primary" size="sm" onClick={() => navigate(`/sites/${focused.id}`)} icon={<ArrowUpRight size={14} />}>
                    Open site detail
                  </Button>
                </div>
              </Card>
            );
          })()}
        </div>
      </div>

      {mapAlarms?.dataSources && mapAlarms.dataSources.demo > 0 && (
        <div className="mini-strip">
          <span><MapPin size={14} /> Coordinates from site registry</span>
          <span><Sun size={14} /> Marker radius scaled by PV capacity</span>
          <span className="muted">DEMO sites: {mapAlarms.dataSources.demo} · LIVE sites: {mapAlarms.dataSources.live}</span>
        </div>
      )}
    </div>
  );
}
