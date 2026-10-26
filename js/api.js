const DEFAULT_TIMEOUT_MS = 10_000;

export class ApiError extends Error {
  constructor(message, { status = 0, payload = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

export async function requestJson(path, { signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutController.signal])
    : timeoutController.signal;

  try {
    const response = await fetch(path, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: combinedSignal,
    });
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json()
      : null;

    if (!response.ok) {
      throw new ApiError(
        payload?.error || `The server answered ${response.status} for ${path}.`,
        { status: response.status, payload },
      );
    }
    return payload;
  } catch (error) {
    if (error.name === "AbortError") throw error;
    if (error instanceof ApiError) throw error;
    throw new ApiError(`Could not reach the Flight Tracker API: ${error.message}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

export function aircraftName(aircraft) {
  return aircraft.flightNumber || aircraft.callsign || aircraft.tailNumber || aircraft.id.toUpperCase();
}

export function projectPosition(latitude, longitude, region) {
  if (![latitude, longitude, region?.latitude, region?.longitude, region?.radiusNm]
    .every(Number.isFinite)) return null;

  const latitudeRadius = region.radiusNm / 60;
  const longitudeRadius = latitudeRadius / Math.max(Math.cos(region.latitude * Math.PI / 180), 0.1);
  return {
    x: 50 + ((longitude - region.longitude) / longitudeRadius) * 50,
    y: 50 - ((latitude - region.latitude) / latitudeRadius) * 50,
  };
}

export function projectedAircraft(aircraft, region) {
  const point = projectPosition(aircraft.latitude, aircraft.longitude, region);
  return point ? { ...aircraft, x: point.x, y: point.y } : null;
}

export function collectAirports(aircraft, region) {
  const airports = new Map();
  for (const item of aircraft) {
    for (const waypoint of item.route?.waypoints || []) {
      if (!waypoint.code || airports.has(waypoint.code)) continue;
      const point = projectPosition(waypoint.latitude, waypoint.longitude, region);
      if (point) airports.set(waypoint.code, { ...waypoint, ...point });
    }
  }
  return airports;
}

export function buildTimeWindow(durationMs, now = Date.now()) {
  const to = new Date(now);
  const from = new Date(now - durationMs);
  return new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
}

export function formatClock(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Not available";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(timestamp);
}

export function formatAge(seconds) {
  if (!Number.isFinite(seconds)) return "waiting for first update";
  if (seconds < 1) return "updated now";
  if (seconds < 60) return `updated ${Math.round(seconds)}s ago`;
  return `updated ${Math.round(seconds / 60)}m ago`;
}
