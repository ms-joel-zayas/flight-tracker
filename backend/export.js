/*
 * Week 11: export recorded positions so they can be analyzed in a spreadsheet
 * or in JavaScript. One row per aircraft per snapshot (about every 30 s), so
 * the same aircraft appears in many rows: count distinct aircraft_id values,
 * not rows, when you ask "how many aircraft?".
 */

export const EXPORT_COLUMNS = Object.freeze([
  ["captured_at", (p) => p.capturedAt],
  ["aircraft_id", (p) => p.id],
  ["flight_session_id", (p) => p.flightSessionId],
  ["callsign", (p) => p.callsign],
  ["flight_number", (p) => p.flightNumber],
  ["tail_number", (p) => p.tailNumber],
  ["aircraft_type", (p) => p.aircraftType],
  ["latitude", (p) => p.latitude],
  ["longitude", (p) => p.longitude],
  ["altitude_feet", (p) => p.altitudeFeet],
  ["speed_knots", (p) => p.speedKnots],
  ["heading_degrees", (p) => p.headingDegrees],
  ["on_ground", (p) => (p.onGround === null || p.onGround === undefined ? null : p.onGround ? 1 : 0)],
  ["origin", (p) => p.origin],
  ["destination", (p) => p.destination],
  ["progress_percent", (p) => p.progressPercent],
  ["eta", (p) => p.eta],
  ["emergency_active", (p) => (p.emergencyActive ? 1 : 0)],
]);

/* A value as one CSV cell: empty for null, quoted when it contains a comma, quote or line break */
function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(points) {
  const header = EXPORT_COLUMNS.map(([name]) => name).join(",");
  const lines = points.map((point) => EXPORT_COLUMNS.map(([, read]) => csvCell(read(point))).join(","));
  return `${[header, ...lines].join("\n")}\n`;
}

export function toRows(points) {
  return points.map((point) => Object.fromEntries(EXPORT_COLUMNS.map(([name, read]) => [name, read(point) ?? null])));
}
