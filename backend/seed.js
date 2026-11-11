/*
 * Replay seed: load the Week 8/9 data.json periods into SQLite so REPLAY works
 * on a fresh clone, or on a network that blocks the live providers.
 *
 *   npm run seed            replace the seeded day with yesterday (UTC)
 *
 * The server also runs this once by itself when the database has no replay
 * dates yet (SEED_REPLAY_IF_EMPTY=true, the default).
 *
 * data.json times (12:00, 12:15 ...) are placed on the most recent full UTC
 * day, so they stay inside the 7-day history window. The flights are the same
 * made-up cross-country placeholders from Weeks 8-9: they show that replay
 * works, not what really flew. Seeded rows are marked with a flight session id
 * that starts with "seed:", so re-seeding replaces them and never touches
 * recorded live data.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SEED_SESSION_PREFIX = "seed:";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/* "Yesterday" in UTC as YYYY-MM-DD */
export function seedDay(nowMs = Date.now()) {
  return new Date(nowMs - ONE_DAY_MS).toISOString().slice(0, 10);
}

/* "12:15" on a UTC day -> milliseconds */
function clockOnDay(day, clock) {
  if (typeof clock !== "string" || !/^\d{2}:\d{2}$/.test(clock)) return null;
  const ms = Date.parse(`${day}T${clock}:00.000Z`);
  return Number.isFinite(ms) ? ms : null;
}

/* Pure: data.json -> one snapshot per period, in the backend's aircraft shape */
export function seedSnapshotsFromDataJson(data, day) {
  const airports = new Map((data.airports || []).map((a) => [a.code, a]));
  const waypoint = (code) => {
    const airport = airports.get(code);
    return airport ? { code, iata: code, name: airport.name, latitude: airport.lat, longitude: airport.lon } : null;
  };

  return (data.periods || []).map((period) => {
    const capturedAtMs = clockOnDay(day, period.time);
    const aircraft = (data.flights || []).map((flight) => {
      const position = period.positions?.[flight.id];
      if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lon)) return null;
      const waypoints = [waypoint(flight.origin), waypoint(flight.destination)].filter(Boolean);
      return {
        id: flight.id.toLowerCase(),
        flightSessionId: `${SEED_SESSION_PREFIX}${flight.id}`,
        callsign: flight.callsign || null,
        flightNumber: flight.flight || null,
        tailNumber: flight.tail || null,
        aircraftType: null,
        latitude: position.lat,
        longitude: position.lon,
        altitudeFeet: Number.isFinite(position.altitude) ? position.altitude : null,
        speedKnots: Number.isFinite(position.speed) ? position.speed : null,
        headingDegrees: Number.isFinite(position.heading) ? position.heading : null,
        origin: flight.origin || null,
        destination: flight.destination || null,
        route: waypoints.length ? { origin: flight.origin, destination: flight.destination, waypoints } : null,
        onGround: false,
        observedAt: new Date(capturedAtMs).toISOString(),
        firstObservedAt: null,
        departureTime: new Date(clockOnDay(day, flight.departed) ?? capturedAtMs).toISOString(),
        departureTimeSource: "scheduled",
        eta: clockOnDay(day, flight.eta) === null ? null : new Date(clockOnDay(day, flight.eta)).toISOString(),
        etaSource: "scheduled",
        progressPercent: Number.isFinite(position.progress) ? position.progress : null,
        remainingDistanceNm: null,
        emergency: null,
      };
    }).filter(Boolean);
    return { capturedAtMs, aircraft };
  }).filter((snapshot) => Number.isFinite(snapshot.capturedAtMs));
}

/* Replace any earlier seed with one built from data.json. Returns what was written. */
export function seedReplay(historyStore, { dataFile, nowMs = Date.now() } = {}) {
  const file = dataFile || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const day = seedDay(nowMs);
  const snapshots = seedSnapshotsFromDataJson(data, day);
  historyStore.removeSeededPositions();
  for (const snapshot of snapshots) historyStore.recordSnapshot(snapshot.aircraft, snapshot.capturedAtMs);
  return { day, frames: snapshots.length, aircraft: snapshots[0]?.aircraft.length || 0 };
}

/* npm run seed */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { loadConfig } = await import("./config.js");
  const { HistoryStore } = await import("./database.js");
  const config = loadConfig();
  const store = new HistoryStore(config.sqlitePath);
  const result = seedReplay(store);
  store.close();
  console.log(`Seeded replay for ${result.day} (UTC): ${result.frames} frames, ${result.aircraft} aircraft, from data.json.`);
}
