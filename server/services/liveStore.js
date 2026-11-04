/** In-memory live snapshot registry shared by simulator, MQTT ingest, REST and WebSocket. */

const states = new Map();
const subscribers = new Set();

export function setLive(siteId, snapshot) {
  states.set(siteId, snapshot);
  for (const fn of subscribers) {
    try {
      fn(snapshot);
    } catch {
      /* subscriber errors must not break ingestion */
    }
  }
}

export function getLive(siteId) {
  return states.get(siteId) || null;
}

export function getAllLive() {
  return [...states.values()];
}

export function removeLive(siteId) {
  states.delete(siteId);
}

export function onLive(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function isStale(snapshot, thresholdMs = 90_000) {
  if (!snapshot) return true;
  return Date.now() - new Date(snapshot.ts).getTime() > thresholdMs;
}

export function publicSnapshot(snapshot) {
  if (!snapshot) return null;
  const { _env, ...rest } = snapshot;
  return rest;
}
