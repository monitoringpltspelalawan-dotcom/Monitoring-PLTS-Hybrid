import { config } from '../config.js';
import { getDb } from '../db/adapter.js';
import { clamp, hashSeed, round, safeJsonParse, uid } from '../lib/util.js';
import { localDateKey, localHourDecimal, localHourKey, nowIso, partsInTz } from '../lib/time.js';
import { isOutage, loadFactor, solarFactor } from './physics.js';
import * as live from './liveStore.js';

const TICK_MS = config.simulationIntervalMs;
const PERSIST_EVERY_TICKS = Math.max(4, Math.round(60_000 / TICK_MS));
const HEALTH_EVERY_TICKS = Math.max(2, Math.round(30_000 / TICK_MS));

const jitter = (seed, ts, scale = 1) =>
  Math.sin(ts / 17_000 + seed * 7.13) * 0.6 + Math.sin(ts / 5_300 + seed * 3.71) * 0.4 * scale;

const addEnergy = (acc, key, kw, dtHours) => {
  acc[key] += Math.max(0, kw) * dtHours;
};

class Simulator {
  constructor(db) {
    this.db = db;
    this.sites = new Map();
    this.timer = null;
    this.tickCount = 0;
    this.running = false;
    this.startedAt = Date.now();
  }

  async init() {
    await this.loadAll();
    this.running = true;
    this.timer = setInterval(() => this.tick().catch((e) => console.error('[sim] tick failed', e)), TICK_MS);
    // First snapshot immediately so the UI has data.
    await this.tick(true);
    console.log(`[sim] demo simulator started for ${this.sites.size} sites (${TICK_MS} ms tick)`);
  }

  async loadAll() {
    const db = this.db;
    const sites = await db.all('SELECT * FROM sites ORDER BY code');
    const gateways = await db.all('SELECT * FROM gateways');
    const devices = await db.all('SELECT * FROM devices');
    const racks = await db.all('SELECT * FROM bess_racks');
    const daily = await db.all('SELECT * FROM site_energy_daily WHERE day >= ?', [
      `${new Date().getUTCFullYear()}-01-01`,
    ]);
    const nextSites = new Map();

    for (const site of sites) {
      if (site.data_source !== 'DEMO') continue;
      const gw = gateways.find((g) => g.site_id === site.id) || null;
      const devs = devices.filter((d) => d.site_id === site.id);
      const siteRacks = racks.filter((r) => r.site_id === site.id);
      const profile = {
        ...safeJsonParse(site.sim_profile, {}),
        seed: hashSeed(site.id),
        latitude: site.latitude,
        timezone: site.timezone,
        kwp: site.pv_capacity_kwp,
      };
      const existingEntry = this.sites.get(site.id);
      if (existingEntry) {
        // preserve live in-memory state on refresh
        existingEntry.site = site;
        existingEntry.gateway = gw;
        existingEntry.devices = devs;
        existingEntry.devicesByType = {
          inverters: devs.filter((d) => d.device_type.includes('INVERTER')),
          bess: devs.find((d) => d.device_type === 'BESS') || devs.find((d) => d.device_type === 'BMS'),
          bms: devs.find((d) => d.device_type === 'BMS'),
          gridMeter: devs.find((d) => d.device_type === 'GRID_METER') || devs.find((d) => d.device_type === 'METER'),
          loadMeter: devs.find((d) => d.device_type === 'LOAD_METER') || devs.find((d) => d.device_type === 'METER'),
          generator: devs.find((d) => d.device_type === 'GENERATOR'),
        };
        existingEntry.racks = siteRacks;
        existingEntry.profile = profile;
        nextSites.set(site.id, existingEntry);
        continue;
      }
      const today = localDateKey(new Date(), site.timezone);
      const todayRow = daily.find((d) => d.site_id === site.id && d.day === today);
      const monthPrefix = today.slice(0, 7);
      const yearPrefix = today.slice(0, 4);
      const monthPv = daily
        .filter((d) => d.site_id === site.id && d.day.startsWith(monthPrefix) && d.day !== today)
        .reduce((a, d) => a + d.pv_kwh, 0);
      const yearPv = daily
        .filter((d) => d.site_id === site.id && d.day.startsWith(yearPrefix) && d.day !== today)
        .reduce((a, d) => a + d.pv_kwh, 0);

      const existing = await db.get('SELECT * FROM site_live_state WHERE site_id = ?', [site.id]);
      const prev = safeJsonParse(existing?.payload, null);
      const recent = prev && Date.now() - new Date(prev.ts).getTime() < 5 * 60_000 ? prev : null;

      const accum = {
        pvKwh: todayRow?.pv_kwh || 0,
        chargeKwh: todayRow?.charge_kwh || 0,
        dischargeKwh: todayRow?.discharge_kwh || 0,
        loadKwh: todayRow?.load_kwh || 0,
        importKwh: todayRow?.import_kwh || 0,
        exportKwh: todayRow?.export_kwh || 0,
        generatorKwh: todayRow?.generator_kwh || 0,
        peakLoadKw: todayRow?.peak_load_kw || 0,
        peakPvKw: todayRow?.peak_pv_kw || 0,
      };
      const hourAccum = {
        hourKey: localHourKey(new Date(), site.timezone),
        pvKwh: 0, chargeKwh: 0, dischargeKwh: 0, loadKwh: 0, importKwh: 0, exportKwh: 0, generatorKwh: 0, peakLoadKw: 0,
      };
      const seed = hashSeed(site.id);
      const soc = recent?.bess?.socPct ?? clamp(48 + ((seed % 33) - 16), 22, 92);
      const env = recent?._env
        ? { ...recent._env, lastTs: Date.now() }
        : {
            soc,
            genRunning: false,
            genHours: 1200 + (seed % 4000) / 10,
            fuelLevelPct: 55 + (seed % 40),
            lastTs: Date.now(),
            inverterTemps: devs.filter((d) => d.device_type.includes('INVERTER')).map(() => 38 + (seed % 8)),
            gridOutage: false,
            offlineSince: null,
          };
      const devicesByType = {
        inverters: devs.filter((d) => d.device_type.includes('INVERTER')),
        bess: devs.find((d) => d.device_type === 'BESS') || devs.find((d) => d.device_type === 'BMS'),
        bms: devs.find((d) => d.device_type === 'BMS'),
        gridMeter: devs.find((d) => d.device_type === 'GRID_METER') || devs.find((d) => d.device_type === 'METER'),
        loadMeter: devs.find((d) => d.device_type === 'LOAD_METER') || devs.find((d) => d.device_type === 'METER'),
        generator: devs.find((d) => d.device_type === 'GENERATOR'),
      };
      nextSites.set(site.id, {
        site,
        gateway: gw,
        devices: devs,
        devicesByType,
        racks: siteRacks,
        profile,
        accum,
        hourAccum,
        monthPv,
        yearPv,
        env,
        dataSource: 'DEMO',
        lastMeasurementTs: 0,
        lastSnapshot: recent,
      });
    }
    this.sites = nextSites;
  }

  async refreshSite(siteId) {
    await this.loadAll();
    const entry = this.sites.get(siteId);
    if (entry) await this.buildSnapshot(entry, Date.now(), true);
  }

  async refreshAll() {
    await this.loadAll();
  }

  getEntry(siteId) {
    return this.sites.get(siteId);
  }

  listEntries() {
    return [...this.sites.values()];
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.running = false;
  }

  async tick(force = false) {
    if (!this.running && !force) return;
    this.tickCount += 1;
    const now = Date.now();
    const snapshots = [];
    for (const entry of this.sites.values()) {
      try {
        const snap = await this.buildSnapshot(entry, now);
        if (snap) snapshots.push(snap);
      } catch (err) {
        console.error(`[sim] site ${entry.site.code} failed`, err.message);
      }
    }
    if (this.tickCount % PERSIST_EVERY_TICKS === 0) {
      await this.persist(snapshots, now);
    }
    if (this.tickCount % HEALTH_EVERY_TICKS === 0) {
      await this.persistHealth(snapshots);
    }
  }

  async buildSnapshot(entry, now, force = false) {
    const { site, profile, devicesByType } = entry;
    const tz = site.timezone || 'Asia/Jakarta';
    const nowDate = new Date(now);
    const localHour = localHourDecimal(nowDate, tz);
    const todayKey = localDateKey(nowDate, tz);
    const seed = entry.profile.seed || 1;
    const commState = (site.comm_status || 'ONLINE').toUpperCase();
    const offline = commState === 'OFFLINE' || site.status === 'OFFLINE';
    const dataSource = 'DEMO';

    if (offline) {
      const last = live.getLive(site.id) || entry.lastSnapshot;
      const staleSnapshot = {
        ...(last || this.emptySnapshot(entry, now)),
        ts: last?.ts || new Date(now - 3600_000).toISOString(),
        lastSeenAt: last?.lastSeenAt || site.last_seen_at,
        stale: true,
        quality: 'BAD',
        commStatus: 'OFFLINE',
        gateway: { ...(last?.gateway || {}), status: 'OFFLINE', latencyMs: 0 },
        dataSource,
      };
      live.setLive(site.id, staleSnapshot);
      return null;
    }

    const dtHours = Math.min(0.02, Math.max(0, (now - entry.env.lastTs) / 3_600_000));
    entry.env.lastTs = now;

    // ---- solar & load -------------------------------------------------
    const solar = solarFactor(profile, nowDate);
    const weather = clamp(1 + jitter(seed, now, 0.4) * 0.05, 0.8, 1.2);
    const performanceRatio = 0.865;
    let pvKw = site.pv_capacity_kwp * solar * performanceRatio * weather;
    if (site.status === 'MAINTENANCE') pvKw *= 0.55;
    if (commState === 'DEGRADED') pvKw *= 0.97;
    const loadShape = loadFactor(localHour, { shifts: profile.shifts || 'industrial' });
    const loadNoise = 1 + jitter(seed + 3, now, 0.5) * 0.045;
    const requestedLoadKw = Math.max(
      3,
      (profile.loadBaseKw || site.pv_capacity_kwp * 0.2) +
        ((profile.loadPeakKw || site.pv_capacity_kwp * 0.7) - (profile.loadBaseKw || 0)) * loadShape * loadNoise,
    );

    // ---- grid availability & generator -------------------------------
    const outage = isOutage(profile, nowDate);
    if (outage && !entry.env.gridOutage) {
      entry.env.gridOutage = true;
      entry.env.outageStart = now;
    } else if (!outage && entry.env.gridOutage) {
      entry.env.gridOutage = false;
    }
    const gridAvailable = !outage;
    const genCapacity = site.generator_capacity_kw || 0;
    const wantGenerator = !gridAvailable && genCapacity > 0;
    if (wantGenerator && !entry.env.genRunning) {
      entry.env.genRunning = true;
    } else if (!wantGenerator && entry.env.genRunning && gridAvailable) {
      entry.env.genRunning = false;
    }

    // ---- BESS dispatch ------------------------------------------------
    const bessCap = site.bess_capacity_kwh || 0;
    const bessPowerMax = site.bess_power_kw || (bessCap ? bessCap * 0.25 : 0);
    let soc = entry.env.soc ?? 60;
    let chargeKw = 0;
    let dischargeKw = 0;
    let batteryTemp = 30 + (site.latitude ? Math.abs(site.latitude) * 0.05 : 0.4) + Math.abs(jitter(seed + 8, now, 1)) * 2.4;
    if (bessCap > 0) {
      const excess = pvKw - requestedLoadKw;
      if (excess > 0.5 && soc < 96) {
        chargeKw = Math.min(excess, bessPowerMax, ((97 - soc) / 100) * bessCap * 2);
      } else if (excess < -0.5 && soc > 18) {
        dischargeKw = Math.min(-excess, bessPowerMax, ((soc - 12) / 100) * bessCap * 2);
      }
      // keep the battery inside a healthy operating band during the demo
      if (soc > 94) chargeKw = 0;
      if (soc < 22 && gridAvailable) dischargeKw = 0;
      soc = clamp(soc + ((chargeKw * 0.96 - dischargeKw / 0.96) * dtHours * 100) / bessCap, 5, 99);
      batteryTemp += (Math.abs(chargeKw - dischargeKw) / Math.max(1, bessPowerMax)) * 9;
      if (profile.thermalIssue) batteryTemp += 6;
      if (soc < 18) batteryTemp += 1.5;
    }
    entry.env.soc = soc;

    // ---- energy balance ----------------------------------------------
    let genKw = 0;
    let gridImportKw = 0;
    let gridExportKw = 0;
    let servedLoadKw = requestedLoadKw;
    const gridCapacityKw = site.grid_capacity_kva ? site.grid_capacity_kva * 0.9 : 10_000;
    const exportLimitKw = site.grid_capacity_kva ? site.grid_capacity_kva * 0.35 : 10_000;

    if (gridAvailable) {
      let net = requestedLoadKw + chargeKw - pvKw - dischargeKw;
      if (net < -exportLimitKw) {
        const curtail = -net - exportLimitKw;
        pvKw = Math.max(0, pvKw - curtail);
        net = -exportLimitKw;
      }
      if (net > gridCapacityKw) {
        servedLoadKw = Math.max(0, requestedLoadKw - (net - gridCapacityKw));
        net = gridCapacityKw;
      }
      if (net >= 0) gridImportKw = net;
      else gridExportKw = -net;
    } else {
      genKw = entry.env.genRunning ? clamp(requestedLoadKw + chargeKw - pvKw - dischargeKw, 0, genCapacity) : 0;
      const deficit = requestedLoadKw + chargeKw - pvKw - dischargeKw - genKw;
      if (deficit > 0) servedLoadKw = Math.max(0, requestedLoadKw - deficit);
    }
    if (chargeKw > 0 && pvKw > 0) {
      // charging power can never exceed available surplus + grid import
      chargeKw = Math.min(chargeKw, Math.max(0, pvKw - servedLoadKw) + gridImportKw);
    }

    // ---- accumulate energy -------------------------------------------
    addEnergy(entry.accum, 'pvKwh', pvKw, dtHours);
    addEnergy(entry.accum, 'chargeKwh', chargeKw, dtHours);
    addEnergy(entry.accum, 'dischargeKwh', dischargeKw, dtHours);
    addEnergy(entry.accum, 'loadKwh', servedLoadKw, dtHours);
    addEnergy(entry.accum, 'importKwh', gridImportKw, dtHours);
    addEnergy(entry.accum, 'exportKwh', gridExportKw, dtHours);
    addEnergy(entry.accum, 'generatorKwh', genKw, dtHours);
    entry.accum.peakLoadKw = Math.max(entry.accum.peakLoadKw, servedLoadKw);
    entry.accum.peakPvKw = Math.max(entry.accum.peakPvKw, pvKw);
    const hourKey = localHourKey(nowDate, tz);
    if (entry.hourAccum.hourKey !== hourKey) {
      entry.hourAccum = {
        hourKey, pvKwh: 0, chargeKwh: 0, dischargeKwh: 0, loadKwh: 0, importKwh: 0, exportKwh: 0, generatorKwh: 0, peakLoadKw: 0,
      };
    }
    addEnergy(entry.hourAccum, 'pvKwh', pvKw, dtHours);
    addEnergy(entry.hourAccum, 'chargeKwh', chargeKw, dtHours);
    addEnergy(entry.hourAccum, 'dischargeKwh', dischargeKw, dtHours);
    addEnergy(entry.hourAccum, 'loadKwh', servedLoadKw, dtHours);
    addEnergy(entry.hourAccum, 'importKwh', gridImportKw, dtHours);
    addEnergy(entry.hourAccum, 'exportKwh', gridExportKw, dtHours);
    addEnergy(entry.hourAccum, 'generatorKwh', genKw, dtHours);
    entry.hourAccum.peakLoadKw = Math.max(entry.hourAccum.peakLoadKw, servedLoadKw);

    if (entry.env.genRunning) {
      const burned = (0.55 + genKw * 0.0009) * dtHours * 60; // litres/hour scaled
      entry.env.fuelLevelPct = Math.max(3, entry.env.fuelLevelPct - burned * 0.02);
      entry.env.genHours = (entry.env.genHours || 0) + dtHours;
    }

    // ---- derived measurements ----------------------------------------
    const gridVoltageBase = profile.weakGrid ? 207 : 230;
    const voltageJitter = jitter(seed + 11, now, 1) * (profile.weakGrid ? 8 : 2.6);
    const gridVoltage = gridAvailable ? gridVoltageBase + voltageJitter : 0;
    const frequency = gridAvailable ? 50 + jitter(seed + 13, now, 1) * 0.08 : 0;
    const dcVoltage = clamp(560 + solar * 210 + jitter(seed + 17, now, 1) * 6, 500, 800);
    const dcCurrent = dcVoltage > 0 ? (pvKw * 1000) / dcVoltage : 0;
    const inverterCapacity = site.inverter_capacity_kw || site.pv_capacity_kwp;
    const powerFactor = 0.93 + jitter(seed + 19, now, 1) * 0.02;
    const reactivePower = pvKw * Math.tan(Math.acos(clamp(powerFactor, 0.85, 0.99)));

    const inverterCount = Math.max(1, devicesByType.inverters.length || site.inverter_count || 1);
    const inverterSnapshots = devicesByType.inverters.map((device, idx) => {
      const share = 1 / inverterCount;
      const shareNoise = clamp(1 + jitter(seed + idx + 23, now, 1) * 0.05, 0.85, 1.15);
      const p = Math.max(0, pvKw * share * shareNoise);
      const tempTarget = 36 + (p / Math.max(1, inverterCapacity / inverterCount)) * 26;
      if (!entry.env.inverterTemps) entry.env.inverterTemps = [];
      const prevTemp = entry.env.inverterTemps[idx] ?? 38;
      const temp = clamp(prevTemp + (tempTarget - prevTemp) * 0.08 + jitter(seed + idx + 27, now, 1) * 0.15, 28, 84);
      entry.env.inverterTemps[idx] = temp;
      let status = 'RUNNING';
      let faultCode = 0;
      if (p < 0.5) status = 'STANDBY';
      if (commState === 'DEGRADED' && idx === 0 && Math.floor(now / 60_000) % 17 === 0) {
        status = 'COMM_LOSS';
        faultCode = 0;
      }
      if (device.status === 'FAULT') {
        status = 'FAULT';
        faultCode = 42 + idx;
      }
      return {
        id: device.id,
        name: device.name,
        model: device.model,
        manufacturer: device.manufacturer,
        status,
        faultCode,
        powerKw: round(p),
        dcVoltageV: round(dcVoltage + jitter(seed + idx, now, 1) * 4, 1),
        dcCurrentA: round(dcVoltage > 0 ? (p * 1000) / dcVoltage : 0, 1),
        acVoltageV: round(gridAvailable ? gridVoltage : 400, 1),
        acCurrentA: round((p * 1000) / (Math.sqrt(3) * Math.max(1, gridAvailable ? gridVoltage : 400) * powerFactor), 1),
        frequencyHz: round(frequency, 2),
        powerFactor: round(powerFactor, 3),
        reactivePowerKvar: round(p * Math.tan(Math.acos(powerFactor)), 1),
        temperatureC: round(temp, 1),
        efficiencyPct: round(p > 0 ? 96.4 + jitter(seed + idx + 29, now, 1) * 1.6 : 0, 1),
        mppt1Kw: round(p * 0.53),
        mppt2Kw: round(p * 0.47),
        dailyEnergyKwh: round(entry.accum.pvKwh * share, 1),
        totalEnergyKwh: round(120_000 + (seed % 9000) + entry.accum.pvKwh, 0),
      };
    });

    const bessVoltage = 720 + (soc / 100) * 90 + jitter(seed + 31, now, 1) * 3;
    const batteryPower = dischargeKw - chargeKw;
    const bessCurrent = bessVoltage > 0 ? (batteryPower * 1000) / bessVoltage : 0;
    const rackList = entry.racks.map((rack, idx) => {
      const rackSoc = clamp(soc + jitter(seed + idx + 41, now, 1) * 2.5, 5, 100);
      return {
        id: rack.id,
        name: rack.name,
        capacityKwh: rack.capacity_kwh,
        socPct: round(rackSoc, 1),
        sohPct: round(97.4 - idx * 0.4 - (seed % 10) / 20, 1),
        voltageV: round(51.2 + jitter(seed + idx + 43, now, 1) * 0.25, 2),
        currentA: round(bessCurrent / Math.max(1, entry.racks.length) + jitter(seed + idx + 47, now, 1), 1),
        temperatureC: round(batteryTemp + jitter(seed + idx + 53, now, 1) * 1.2 - 0.5, 1),
        status: rack.status || 'ONLINE',
        moduleCount: rack.module_count,
      };
    });

    const gridCurrent = gridVoltage > 0 ? ((gridImportKw || gridExportKw) * 1000) / (Math.sqrt(3) * gridVoltage) : 0;
    const loadCurrent = servedLoadKw > 0 ? (servedLoadKw * 1000) / (Math.sqrt(3) * Math.max(1, gridVoltage || 400) * 0.92) : 0;
    const genCurrent = genKw > 0 ? (genKw * 1000) / (Math.sqrt(3) * 400 * 0.88) : 0;

    entry.lastSnapshot = {
      siteId: site.id,
      siteCode: site.code,
      siteName: site.name,
      regionId: site.region_id,
      ts: new Date(now).toISOString(),
      localTime: new Date(now).toISOString(),
      lastSeenAt: new Date(now).toISOString(),
      dataSource,
      quality: commState === 'DEGRADED' ? 'UNCERTAIN' : 'GOOD',
      stale: false,
      status: site.status,
      commStatus: commState === 'DEGRADED' ? 'DEGRADED' : 'ONLINE',
      latencyMs: commState === 'DEGRADED' ? round(420 + Math.abs(jitter(seed + 59, now, 1)) * 700, 0) : round(35 + Math.abs(jitter(seed + 61, now, 1)) * 80, 0),
      gateway: {
        id: entry.gateway?.id,
        name: entry.gateway?.name,
        serial: entry.gateway?.serial,
        status: 'ONLINE',
        lastSeenAt: new Date(now).toISOString(),
        latencyMs: commState === 'DEGRADED' ? 620 : 48,
        backlog: commState === 'DEGRADED' ? Math.round(120 + Math.abs(jitter(seed + 67, now, 1)) * 900) : 0,
        cpuPct: round(22 + Math.abs(jitter(seed + 71, now, 1)) * 18, 1),
        memPct: round(41 + Math.abs(jitter(seed + 73, now, 1)) * 12, 1),
        uptimeSec: Math.round((now - this.startedAt) / 1000) + 86400 * 23,
        firmware: entry.gateway?.firmware || 'edge-1.4.2',
        ipAddress: entry.gateway?.ip_address,
      },
      pv: {
        powerKw: round(pvKw),
        voltageV: round(dcVoltage, 1),
        currentA: round(dcCurrent, 1),
        irradianceWm2: round(solar * 1000),
        dailyKwh: round(entry.accum.pvKwh, 1),
        monthlyKwh: round(entry.monthPv + entry.accum.pvKwh, 0),
        annualKwh: round(entry.yearPv + entry.accum.pvKwh, 0),
        specificYield: round(site.pv_capacity_kwp ? entry.accum.pvKwh / site.pv_capacity_kwp : 0, 2),
        performanceRatio: round((solar * performanceRatio * 100), 1),
        inverters: inverterSnapshots,
      },
      inverter: {
        activePowerKw: round(pvKw),
        reactivePowerKvar: round(reactivePower),
        apparentPowerKva: round(Math.sqrt(pvKw ** 2 + reactivePower ** 2)),
        powerFactor: round(powerFactor, 3),
        dcVoltageV: round(dcVoltage, 1),
        dcCurrentA: round(dcCurrent, 1),
        acVoltageL1V: round(gridAvailable ? gridVoltage : 400, 1),
        acVoltageL2V: round(gridAvailable ? gridVoltage * 0.998 : 400, 1),
        acVoltageL3V: round(gridAvailable ? gridVoltage * 1.002 : 400, 1),
        acCurrentL1A: round(gridCurrent || loadCurrent, 1),
        acCurrentL2A: round((gridCurrent || loadCurrent) * 0.99, 1),
        acCurrentL3A: round((gridCurrent || loadCurrent) * 1.01, 1),
        frequencyHz: round(frequency, 2),
        temperatureC: round(inverterSnapshots[0]?.temperatureC || 0, 1),
        efficiencyPct: round(inverterSnapshots[0]?.efficiencyPct || 0, 1),
        status: inverterSnapshots.some((i) => i.status === 'FAULT') ? 'FAULT' : pvKw > 1 ? 'RUNNING' : 'STANDBY',
        faultCode: inverterSnapshots.find((i) => i.faultCode)?.faultCode || 0,
      },
      bess: {
        capacityKwh: bessCap,
        socPct: round(soc, 1),
        sohPct: round(97.1 - (seed % 18) / 10, 1),
        voltageV: round(bessVoltage, 1),
        currentA: round(bessCurrent, 1),
        powerKw: round(batteryPower),
        chargePowerKw: round(chargeKw),
        dischargePowerKw: round(dischargeKw),
        temperatureC: round(batteryTemp, 1),
        availableKwh: round((bessCap * Math.max(0, soc - 5)) / 100, 1),
        remainingKwh: round((bessCap * soc) / 100, 1),
        bmsStatus: batteryTemp > 55 ? 'PROTECTION' : 'NORMAL',
        racks: rackList,
      },
      grid: {
        available: gridAvailable,
        voltageL1V: round(gridVoltage, 1),
        voltageL2V: round(gridAvailable ? gridVoltage * 0.999 : 0, 1),
        voltageL3V: round(gridAvailable ? gridVoltage * 1.001 : 0, 1),
        currentL1A: round(gridCurrent, 1),
        currentL2A: round(gridCurrent * 0.98, 1),
        currentL3A: round(gridCurrent * 1.02, 1),
        frequencyHz: round(frequency, 2),
        activePowerKw: round(gridImportKw - gridExportKw),
        importKw: round(gridImportKw),
        exportKw: round(gridExportKw),
        importKwh: round(entry.accum.importKwh, 1),
        exportKwh: round(entry.accum.exportKwh, 1),
        powerFactor: round(powerFactor, 3),
        reactivePowerKvar: round(reactivePower, 1),
        capacityKva: site.grid_capacity_kva,
      },
      generator: {
        present: (site.generator_count || 0) > 0,
        running: Boolean(entry.env.genRunning),
        voltageV: genKw > 0 ? 400 + jitter(seed + 79, now, 1) * 2 : 0,
        currentA: round(genCurrent, 1),
        frequencyHz: genKw > 0 ? round(50 + jitter(seed + 83, now, 1) * 0.15, 2) : 0,
        powerKw: round(genKw),
        runHours: round(entry.env.genHours || 0, 1),
        fuelLevelPct: round(entry.env.fuelLevelPct, 1),
        status: entry.env.genRunning ? (genKw > 0 ? 'RUNNING' : 'IDLE') : 'STOPPED',
        capacityKw: genCapacity,
        energyKwh: round(entry.accum.generatorKwh, 1),
      },
      load: {
        powerKw: round(servedLoadKw),
        requestedKw: round(requestedLoadKw),
        voltageV: round(gridAvailable ? gridVoltage : 400, 1),
        currentA: round(loadCurrent, 1),
        frequencyHz: round(frequency || 50, 2),
        energyKwh: round(entry.accum.loadKwh, 1),
        powerFactor: round(0.92 + jitter(seed + 89, now, 1) * 0.02, 3),
        apparentPowerKva: round(servedLoadKw / 0.92),
        peakDemandKw: round(entry.accum.peakLoadKw, 1),
      },
      flow: {
        pvKw: round(pvKw),
        batteryKw: round(batteryPower),
        gridKw: round(gridImportKw - gridExportKw),
        generatorKw: round(genKw),
        loadKw: round(servedLoadKw),
      },
      energy: {
        pvTodayKwh: round(entry.accum.pvKwh, 2),
        pvMonthKwh: round(entry.monthPv + entry.accum.pvKwh, 1),
        pvYearKwh: round(entry.yearPv + entry.accum.pvKwh, 1),
        chargeTodayKwh: round(entry.accum.chargeKwh, 2),
        dischargeTodayKwh: round(entry.accum.dischargeKwh, 2),
        loadTodayKwh: round(entry.accum.loadKwh, 2),
        importTodayKwh: round(entry.accum.importKwh, 2),
        exportTodayKwh: round(entry.accum.exportKwh, 2),
        generatorTodayKwh: round(entry.accum.generatorKwh, 2),
        peakLoadKw: round(entry.accum.peakLoadKw, 1),
      },
      _env: entry.env,
    };

    live.setLive(site.id, entry.lastSnapshot);
    return entry.lastSnapshot;
  }

  emptySnapshot(entry, now) {
    const { site } = entry;
    return {
      siteId: site.id,
      siteCode: site.code,
      siteName: site.name,
      ts: new Date(now).toISOString(),
      dataSource: 'DEMO',
      quality: 'BAD',
      stale: true,
      status: 'OFFLINE',
      commStatus: 'OFFLINE',
      gateway: { id: entry.gateway?.id, status: 'OFFLINE' },
      pv: { powerKw: 0, dailyKwh: 0, inverters: [] },
      bess: { socPct: null, racks: [] },
      grid: { available: false },
      generator: { present: false, running: false },
      load: { powerKw: 0 },
      flow: { pvKw: 0, batteryKw: 0, gridKw: 0, generatorKw: 0, loadKw: 0 },
    };
  }

  async persist(snapshots) {
    const db = this.db;
    const rows = [];
    const serverTs = nowIso();
    for (const snap of snapshots) {
      if (!snap || snap.stale) continue;
      const entry = this.sites.get(snap.siteId);
      if (!entry) continue;
      const { site, devicesByType, gateway } = entry;
      const tz = site.timezone;
      const today = localDateKey(new Date(), tz);
      const hour = localHourKey(new Date(), tz);
      const base = {
        site_id: site.id,
        gateway_id: gateway?.id || null,
        device_ts: snap.ts,
        server_ts: serverTs,
        quality: snap.quality,
        seq: Math.floor(Date.now() / 1000) % 2_000_000_000,
        data_source: 'DEMO',
      };
      const push = (deviceId, parameterId, value, unit) => {
        if (value === null || value === undefined || Number.isNaN(Number(value))) return;
        rows.push({ ...base, device_id: deviceId, parameter_id: parameterId, value: Number(value), unit });
      };
      push(devicesByType.inverters[0]?.id, 'pv_power_kw', snap.pv.powerKw, 'kW');
      push(devicesByType.inverters[0]?.id, 'pv_voltage_v', snap.pv.voltageV, 'V');
      push(devicesByType.inverters[0]?.id, 'pv_current_a', snap.pv.currentA, 'A');
      push(devicesByType.inverters[0]?.id, 'inverter_power_kw', snap.inverter.activePowerKw, 'kW');
      push(devicesByType.inverters[0]?.id, 'inverter_temp_c', snap.inverter.temperatureC, '°C');
      push(devicesByType.bess?.id, 'soc_pct', snap.bess.socPct, '%');
      push(devicesByType.bess?.id, 'soh_pct', snap.bess.sohPct, '%');
      push(devicesByType.bess?.id, 'battery_power_kw', snap.bess.powerKw, 'kW');
      push(devicesByType.bess?.id, 'battery_temp_c', snap.bess.temperatureC, '°C');
      push(devicesByType.bess?.id, 'battery_voltage_v', snap.bess.voltageV, 'V');
      push(devicesByType.gridMeter?.id, 'grid_power_kw', snap.grid.activePowerKw, 'kW');
      push(devicesByType.gridMeter?.id, 'grid_voltage_l1_v', snap.grid.voltageL1V, 'V');
      push(devicesByType.gridMeter?.id, 'grid_frequency_hz', snap.grid.frequencyHz, 'Hz');
      push(devicesByType.loadMeter?.id, 'load_power_kw', snap.load.powerKw, 'kW');
      push(devicesByType.loadMeter?.id, 'load_energy_kwh', snap.load.energyKwh, 'kWh');
      push(devicesByType.generator?.id, 'generator_power_kw', snap.generator.powerKw, 'kW');
      push(devicesByType.generator?.id, 'generator_fuel_pct', snap.generator.fuelLevelPct, '%');

      // Keep today's counters coherent
      await db.run(
        `INSERT INTO site_energy_daily (site_id, day, pv_kwh, charge_kwh, discharge_kwh, load_kwh, import_kwh, export_kwh, generator_kwh, peak_load_kw, peak_pv_kw, performance_ratio, availability_pct, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(site_id, day) DO UPDATE SET
           pv_kwh=excluded.pv_kwh, charge_kwh=excluded.charge_kwh, discharge_kwh=excluded.discharge_kwh,
           load_kwh=excluded.load_kwh, import_kwh=excluded.import_kwh, export_kwh=excluded.export_kwh,
           generator_kwh=excluded.generator_kwh, peak_load_kw=excluded.peak_load_kw, peak_pv_kw=excluded.peak_pv_kw,
           performance_ratio=excluded.performance_ratio, availability_pct=excluded.availability_pct, updated_at=excluded.updated_at`,
        [
          site.id, today, entry.accum.pvKwh, entry.accum.chargeKwh, entry.accum.dischargeKwh, entry.accum.loadKwh,
          entry.accum.importKwh, entry.accum.exportKwh, entry.accum.generatorKwh, entry.accum.peakLoadKw,
          entry.accum.peakPvKw, snap.pv.performanceRatio ? snap.pv.performanceRatio / 100 : null, 99.6, serverTs,
        ],
      );
      await db.run(
        `INSERT INTO energy_hourly (site_id, hour, pv_kwh, charge_kwh, discharge_kwh, load_kwh, import_kwh, export_kwh, generator_kwh, peak_load_kw, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(site_id, hour) DO UPDATE SET
           pv_kwh=excluded.pv_kwh, charge_kwh=excluded.charge_kwh, discharge_kwh=excluded.discharge_kwh,
           load_kwh=excluded.load_kwh, import_kwh=excluded.import_kwh, export_kwh=excluded.export_kwh,
           generator_kwh=excluded.generator_kwh, peak_load_kw=excluded.peak_load_kw, updated_at=excluded.updated_at`,
        [
          site.id, hour, entry.hourAccum.pvKwh, entry.hourAccum.chargeKwh, entry.hourAccum.dischargeKwh,
          entry.hourAccum.loadKwh, entry.hourAccum.importKwh, entry.hourAccum.exportKwh, entry.hourAccum.generatorKwh,
          entry.hourAccum.peakLoadKw, serverTs,
        ],
      );
      await db.run(
        `INSERT INTO site_live_state (site_id, ts, payload) VALUES (?,?,?)
         ON CONFLICT(site_id) DO UPDATE SET ts=excluded.ts, payload=excluded.payload`,
        [site.id, snap.ts, JSON.stringify(snap)],
      );
      if (gateway) {
        await db.run('UPDATE gateways SET last_seen_at = ?, status = ?, latency_ms = ?, buffer_backlog = ?, cpu_pct = ?, mem_pct = ?, updated_at = ? WHERE id = ?', [
          serverTs, snap.gateway.status, snap.gateway.latencyMs, snap.gateway.backlog, snap.gateway.cpuPct, snap.gateway.memPct, serverTs, gateway.id,
        ]);
        await db.run('UPDATE sites SET last_seen_at = ?, comm_status = ?, updated_at = ? WHERE id = ?', [
          serverTs, snap.commStatus, serverTs, site.id,
        ]);
      }
    }
    if (rows.length) {
      await db.insertMany(
        'measurements',
        ['site_id', 'gateway_id', 'device_id', 'parameter_id', 'value', 'unit', 'device_ts', 'server_ts', 'quality', 'seq', 'data_source'],
        rows,
        { chunkSize: 250 },
      );
    }
  }

  async persistHealth(snapshots) {
    const db = this.db;
    const ts = nowIso();
    const healthRows = [];
    const commRows = [];
    for (const snap of snapshots) {
      if (!snap) continue;
      const entry = this.sites.get(snap.siteId);
      const gw = entry?.gateway;
      if (!gw) continue;
      healthRows.push({
        id: uid('gh'),
        gateway_id: gw.id,
        site_id: snap.siteId,
        ts,
        online: snap.stale ? 0 : 1,
        latency_ms: snap.latencyMs,
        backlog: snap.gateway.backlog,
        cpu_pct: snap.gateway.cpuPct,
        mem_pct: snap.gateway.memPct,
        uptime_sec: snap.gateway.uptimeSec,
        firmware: snap.gateway.firmware,
      });
      commRows.push({
        id: uid('cl'),
        ts,
        gateway_id: gw.id,
        site_id: snap.siteId,
        direction: 'OUTBOUND',
        protocol: 'MQTT/TLS',
        topic: `plts/${snap.siteId}/${gw.id}/telemetry`,
        status: snap.stale ? 'FAILED' : 'OK',
        bytes: 1800 + Math.round(Math.random() * 900),
        latency_ms: snap.latencyMs,
        error: null,
      });
    }
    if (healthRows.length) await db.insertMany('gateway_health', Object.keys(healthRows[0]), healthRows);
    if (commRows.length) await db.insertMany('comm_logs', Object.keys(commRows[0]), commRows);
  }
}

let simulator = null;

export async function startSimulator(db) {
  if (simulator) return simulator;
  simulator = new Simulator(db);
  await simulator.init();
  return simulator;
}

export function getSimulator() {
  return simulator;
}

export function simulatorStats() {
  return {
    running: Boolean(simulator?.running),
    sites: simulator?.sites.size || 0,
    tickMs: TICK_MS,
    uptimeSec: simulator ? Math.round((Date.now() - simulator.startedAt) / 1000) : 0,
    ticks: simulator?.tickCount || 0,
  };
}
