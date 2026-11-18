/*
 * Week 11 reference analysis (mentor answer key). Students write their own,
 * in JavaScript and/or a spreadsheet, and cross-check against these results.
 *
 * Every function takes "rows": one object per aircraft per snapshot, with the
 * column names of the export (GET /api/export, data/recorded-day.csv).
 * Pure functions only: no page, no network. Tests: test/analysis.test.js.
 *
 * The rule that matters most: a snapshot is saved about every 30 seconds, so
 * one aircraft appears in MANY rows. "How many aircraft?" means counting
 * distinct aircraft_id values, not rows.
 */

const EARTH_RADIUS_NM = 3440.065;

/* ---------- reading the data ---------- */

/* A minimal CSV reader for the export (handles quoted cells). Empty cells become null; numbers become numbers. */
export function parseCsv(text) {
  const lines = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell); lines.push(row); row = []; cell = "";
    } else cell += char;
  }
  if (cell !== "" || row.length) { row.push(cell); lines.push(row); }
  const [header, ...body] = lines.filter((line) => line.length > 1 || line[0] !== "");
  return body.map((line) => Object.fromEntries(header.map((name, index) => [name, toValue(line[index])])));
}

function toValue(cell) {
  if (cell === undefined || cell === "") return null;
  const number = Number(cell);
  return Number.isFinite(number) && /^-?\d/.test(cell) && !/^\d{4}-\d{2}-\d{2}T/.test(cell) ? number : cell;
}

/* ---------- the seven simple measures ---------- */

/* Only real numbers: null and missing values are left out of min, max and average (and counted separately). */
export function numbers(rows, field) {
  return rows.map((row) => row[field]).filter((value) => typeof value === "number" && Number.isFinite(value));
}

export const count = (rows) => rows.length;

export function distinctCount(rows, field = "aircraft_id") {
  return new Set(rows.map((row) => row[field]).filter((value) => value !== null && value !== undefined)).size;
}

export function minimum(values) {
  return values.length ? values.reduce((smallest, value) => (value < smallest ? value : smallest)) : null;
}

export function maximum(values) {
  return values.length ? values.reduce((largest, value) => (value > largest ? value : largest)) : null;
}

export function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/* Share of rows where a field has no value (null, missing or empty): 0 to 1 */
export function missingRate(rows, field) {
  if (!rows.length) return null;
  const missing = rows.filter((row) => row[field] === null || row[field] === undefined || row[field] === "").length;
  return missing / rows.length;
}

/* ---------- grouping, sorting and change over time ---------- */

export function groupBy(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

/* "2026-11-18T01:30:00.000Z" -> "01:00" (UTC hour) */
export const utcHour = (row) => `${String(row.captured_at).slice(11, 13)}:00`;

/*
 * Distinct aircraft seen in each UTC hour, in time order: change over time.
 * snapshots shows how much of the hour was recorded (120 = the full hour at 30 s),
 * and averageInView (rows / snapshots) compares partial hours fairly.
 */
export function aircraftPerHour(rows) {
  const hourStart = (row) => String(row.captured_at).slice(0, 13);
  return [...groupBy(rows, hourStart)]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([start, hourRows]) => {
      const snapshots = distinctCount(hourRows, "captured_at");
      return {
        hour: `${start.slice(11, 13)}:00`,
        date: start.slice(0, 10),
        aircraft: distinctCount(hourRows),
        rows: hourRows.length,
        snapshots,
        averageInView: hourRows.length / snapshots,
      };
    });
}

/* One summary row per aircraft: first and last time seen, rows, highest altitude, route known? */
export function perAircraft(rows) {
  return [...groupBy(rows, (row) => row.aircraft_id)].map(([id, aircraftRows]) => {
    const times = aircraftRows.map((row) => Date.parse(row.captured_at)).sort((a, b) => a - b);
    return {
      aircraft_id: id,
      callsign: aircraftRows.find((row) => row.callsign)?.callsign ?? null,
      rows: aircraftRows.length,
      firstSeen: new Date(times[0]).toISOString(),
      lastSeen: new Date(times.at(-1)).toISOString(),
      minutesSeen: (times.at(-1) - times[0]) / 60000,
      maxAltitudeFeet: maximum(numbers(aircraftRows, "altitude_feet")),
      routeKnown: aircraftRows.some((row) => row.origin && row.destination),
    };
  });
}

/* The largest values first (sorting): e.g. sortBy(perAircraft(rows), "maxAltitudeFeet") */
export function sortBy(items, field, direction = "desc") {
  const sign = direction === "desc" ? -1 : 1;
  return [...items].sort((a, b) => {
    if (a[field] === null) return 1;
    if (b[field] === null) return -1;
    return sign * (a[field] - b[field]);
  });
}

/* Seconds between one snapshot and the next, for every aircraft (how often do we really get a new position? REQ-03) */
export function updateGaps(rows) {
  const gaps = [];
  for (const aircraftRows of groupBy(rows, (row) => row.aircraft_id).values()) {
    const times = aircraftRows.map((row) => Date.parse(row.captured_at)).sort((a, b) => a - b);
    for (let i = 1; i < times.length; i += 1) gaps.push((times[i] - times[i - 1]) / 1000);
  }
  return gaps;
}

/* ---------- Challenge examples ---------- */

/* Great-circle distance in nautical miles */
export function distanceNm(from, to) {
  const rad = (degrees) => degrees * Math.PI / 180;
  const dLat = rad(to.latitude - from.latitude);
  const dLon = rad(to.longitude - from.longitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(from.latitude)) * Math.cos(rad(to.latitude)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_NM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* Feet per minute between consecutive snapshots of the same aircraft (positive = climbing) */
export function climbRates(rows) {
  const rates = [];
  for (const aircraftRows of groupBy(rows, (row) => row.aircraft_id).values()) {
    const sorted = aircraftRows
      .filter((row) => typeof row.altitude_feet === "number")
      .sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at));
    for (let i = 1; i < sorted.length; i += 1) {
      const minutes = (Date.parse(sorted[i].captured_at) - Date.parse(sorted[i - 1].captured_at)) / 60000;
      if (minutes > 0 && minutes <= 5) rates.push((sorted[i].altitude_feet - sorted[i - 1].altitude_feet) / minutes);
    }
  }
  return rates;
}

/* Count values into bands, e.g. altitude in 5,000 ft bands */
export function histogram(values, bandSize) {
  const bands = new Map();
  for (const value of values) {
    const start = Math.floor(value / bandSize) * bandSize;
    bands.set(start, (bands.get(start) || 0) + 1);
  }
  return [...bands].sort((a, b) => a[0] - b[0]).map(([start, n]) => ({ from: start, to: start + bandSize, count: n }));
}

/* ---------- one summary for the answer key ---------- */
export function summarize(rows, { reference = { latitude: 42.0773, longitude: -71.6295 } } = {}) {
  const aircraft = perAircraft(rows);
  const airborne = rows.filter((row) => row.on_ground !== 1);
  const altitudes = numbers(airborne, "altitude_feet");
  const speeds = numbers(airborne, "speed_knots");
  const times = rows.map((row) => Date.parse(row.captured_at)).filter(Number.isFinite).sort((a, b) => a - b);
  const gaps = updateGaps(rows);
  const distances = rows
    .filter((row) => typeof row.latitude === "number" && typeof row.longitude === "number")
    .map((row) => distanceNm(reference, row));
  return {
    rows: count(rows),
    snapshots: distinctCount(rows, "captured_at"),
    aircraft: distinctCount(rows),
    from: times.length ? new Date(times[0]).toISOString() : null,
    to: times.length ? new Date(times.at(-1)).toISOString() : null,
    altitudeFeet: { min: minimum(altitudes), max: maximum(altitudes), average: average(altitudes), median: median(altitudes) },
    speedKnots: { min: minimum(speeds), max: maximum(speeds), average: average(speeds), median: median(speeds) },
    missing: {
      callsign: missingRate(rows, "callsign"),
      altitude_feet: missingRate(rows, "altitude_feet"),
      origin: missingRate(rows, "origin"),
      aircraft_type: missingRate(rows, "aircraft_type"),
    },
    aircraftWithRoute: aircraft.filter((item) => item.routeKnown).length,
    perHour: aircraftPerHour(rows),
    medianMinutesSeen: median(aircraft.map((item) => item.minutesSeen)),
    medianUpdateGapSeconds: median(gaps),
    highest: sortBy(aircraft, "maxAltitudeFeet").slice(0, 3),
    distanceFromReferenceNm: { max: maximum(distances), average: average(distances) },
    emergencyRows: rows.filter((row) => row.emergency_active === 1).length,
  };
}
