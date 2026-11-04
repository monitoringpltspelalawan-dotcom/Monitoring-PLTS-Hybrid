import { clamp } from '../lib/util.js';
import { localHourDecimal, partsInTz } from '../lib/time.js';

/**
 * Shared physical model used by the simulator and the historical backfill.
 * Deliberately conservative: plausible diurnal solar geometry, weather
 * attenuation and industrial load shapes, not a bankable yield model.
 */

export function solarGeometry(latitudeDeg, dayOfYear, localHour) {
  const lat = (latitudeDeg * Math.PI) / 180;
  const decl = (23.45 * Math.PI) / 180 * Math.sin((2 * Math.PI * (284 + dayOfYear)) / 365);
  const hourAngle = ((localHour - 12) * 15 * Math.PI) / 180;
  const sinElev = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle);
  return Math.max(0, sinElev);
}

export function clearSkyFactor(latitudeDeg, dayOfYear, localHour) {
  const sinElev = solarGeometry(latitudeDeg, dayOfYear, localHour);
  if (sinElev <= 0.03) return 0;
  return clamp(sinElev * 1.12 + 0.04, 0, 1);
}

/** Smooth pseudo-weather: combines slow and fast waves so clouds do not flicker. */
export function weatherAt(tsMs, seed = 1, cloudiness = 0.25) {
  const minutes = tsMs / 60000;
  const slow = 0.5 + 0.5 * Math.sin(minutes / 47 + seed * 1.7);
  const med = 0.5 + 0.5 * Math.sin(minutes / 13.3 + seed * 3.1);
  const fast = 0.5 + 0.5 * Math.sin(minutes / 3.7 + seed * 5.3);
  const cloudLoad = clamp(0.55 * slow + 0.3 * med + 0.15 * fast, 0, 1);
  const attenuation = cloudiness * (0.25 + 1.05 * cloudLoad);
  return clamp(1 - attenuation, 0.08, 1);
}

export function solarFactor(profile, date) {
  const { hour, year, month, day } = partsInTz(date, profile.timezone || 'Asia/Jakarta');
  const localHour = hour;
  const dayOfYear = Math.floor((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 86400000) + 1;
  const clear = clearSkyFactor(profile.latitude ?? -6.2, dayOfYear, localHour);
  if (clear === 0) return 0;
  const weather = weatherAt(date.getTime(), profile.seed || 1, profile.cloudiness ?? 0.28);
  return clamp(clear * weather, 0, 1);
}

/** Normalised industrial load shape (0.2 .. 1.0). */
export function loadFactor(hour, { shifts = 'industrial' } = {}) {
  const g = (center, width) => Math.exp(-((hour - center) ** 2) / (2 * width * width));
  if (shifts === 'commercial') {
    return clamp(0.25 + 0.75 * g(12.5, 3.4) + 0.3 * g(19, 1.6), 0.2, 1.0);
  }
  if (shifts === 'continuous') {
    return clamp(0.72 + 0.14 * g(9, 3) + 0.16 * g(19, 2.4) - 0.12 * g(3, 2), 0.45, 1.0);
  }
  return clamp(0.3 + 0.5 * g(9.5, 1.9) + 0.42 * g(14, 3.2) + 0.52 * g(19.5, 1.8), 0.18, 1.0);
}

/** Deterministic outage window for a site/day, so refreshes do not flap. */
export function outageWindow(profile, date) {
  if (!profile.gridReliability || profile.gridReliability >= 0.999) return null;
  const day = partsInTz(date, profile.timezone);
  const daySeed = (profile.seed || 1) * 31 + day.year * 372 + day.month * 31 + day.day;
  const r = (Math.sin(daySeed * 12.9898) * 43758.5453) % 1;
  const chance = Math.abs(r);
  if (chance > 1 - profile.gridReliability) {
    const startHour = 9 + (Math.abs(Math.sin(daySeed * 78.233)) * 8);
    const duration = 0.25 + Math.abs(Math.sin(daySeed * 12.33)) * 1.5;
    return { start: startHour, end: startHour + duration };
  }
  return null;
}

export function isOutage(profile, date) {
  const w = outageWindow(profile, date);
  if (!w) return false;
  const h = localHourDecimal(date, profile.timezone || 'Asia/Jakarta');
  return h >= w.start && h <= w.end;
}

/** Estimate a day's PV yield by integrating the physical model hourly. */
export function estimateDailyYieldKwh(profile, dayKey) {
  const [y, m, d] = dayKey.split('-').map(Number);
  let pv = 0;
  for (let h = 0; h < 24; h += 1) {
    const localApprox = new Date(Date.UTC(y, m - 1, d, h));
    const factor = solarFactor(profile, new Date(localApprox.getTime() - 7 * 3600_000));
    pv += profile.kwp * factor * 0.865;
  }
  return pv;
}
