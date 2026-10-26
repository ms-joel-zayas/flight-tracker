import { greatCircleDistanceNm } from "../aircraft.js";

const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_CONCURRENCY = 4;
const MIN_ROUTE_DISTANCE_NM = 1;
const MIN_ROUTE_ALLOWANCE_NM = 100;
const ROUTE_ALLOWANCE_RATIO = 0.2;

function normalizedCallsign(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function coordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeAirport(airport) {
  if (!airport || typeof airport !== "object") return null;
  const iata = airport.iata_code || airport.iata || null;
  const icao = airport.icao_code || airport.icao || null;
  const latitude = coordinate(airport.latitude ?? airport.lat);
  const longitude = coordinate(airport.longitude ?? airport.lon ?? airport.lng);
  if (latitude === null || longitude === null) return null;

  return {
    code: iata || icao,
    iata,
    icao,
    name: airport.name || null,
    latitude,
    longitude,
  };
}

export function normalizeAdsbDbRoute(payload) {
  const rawRoute = payload?.response?.flightroute || payload?.flightroute || payload;
  if (!rawRoute || typeof rawRoute !== "object") return null;

  const callsign = normalizedCallsign(rawRoute.callsign_icao || rawRoute.callsign);
  const midpointValues = Array.isArray(rawRoute.midpoints)
    ? rawRoute.midpoints
    : rawRoute.midpoint
      ? [rawRoute.midpoint]
      : [];
  const waypoints = [rawRoute.origin, ...midpointValues, rawRoute.destination]
    .map(normalizeAirport)
    .filter(Boolean);
  const origin = waypoints[0];
  const destination = waypoints.at(-1);
  if (!callsign || waypoints.length < 2 || !origin?.code || !destination?.code) return null;

  return {
    callsign,
    origin: origin.code,
    destination: destination.code,
    airportCodes: waypoints.map((airport) => airport.code).filter(Boolean),
    waypoints,
    plausible: null,
    source: "adsbdb",
  };
}

export function isAdsbDbRoutePlausible(route, aircraft) {
  const origin = route?.waypoints?.[0];
  const destination = route?.waypoints?.at(-1);
  const current = {
    latitude: Number(aircraft?.latitude),
    longitude: Number(aircraft?.longitude),
  };
  const routeDistanceNm = greatCircleDistanceNm(origin, destination);
  const fromOriginNm = greatCircleDistanceNm(origin, current);
  const toDestinationNm = greatCircleDistanceNm(current, destination);
  if (![routeDistanceNm, fromOriginNm, toDestinationNm].every(Number.isFinite)) return false;
  if (routeDistanceNm < MIN_ROUTE_DISTANCE_NM) return false;

  const allowanceNm = Math.max(MIN_ROUTE_ALLOWANCE_NM, routeDistanceNm * ROUTE_ALLOWANCE_RATIO);
  return fromOriginNm + toDestinationNm <= routeDistanceNm + allowanceNm;
}

export class AdsbDbProvider {
  constructor({
    baseUrl,
    userAgent,
    maxConcurrency = DEFAULT_CONCURRENCY,
    fetchImpl = globalThis.fetch,
  }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.userAgent = userAgent;
    this.maxConcurrency = maxConcurrency;
    this.fetch = fetchImpl;
  }

  async fetchRoute(callsign) {
    const normalized = normalizedCallsign(callsign);
    if (!/^[A-Z0-9]{2,10}$/.test(normalized)) return null;

    const response = await this.fetch(
      `${this.baseUrl}/v0/callsign/${encodeURIComponent(normalized)}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": this.userAgent,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`ADSBDB returned HTTP ${response.status}`);
    return normalizeAdsbDbRoute(await response.json());
  }

  async fetchRoutes(aircraft) {
    const byCallsign = new Map();
    for (const item of aircraft) {
      const callsign = normalizedCallsign(item.callsign);
      if (callsign && !byCallsign.has(callsign)) byCallsign.set(callsign, item);
    }
    const pending = [...byCallsign.keys()];
    const routes = new Map();
    const errors = [];
    let nextIndex = 0;

    const worker = async () => {
      while (nextIndex < pending.length) {
        const callsign = pending[nextIndex];
        nextIndex += 1;
        try {
          const route = await this.fetchRoute(callsign);
          if (route && isAdsbDbRoutePlausible(route, byCallsign.get(callsign))) {
            routes.set(callsign, { ...route, plausible: true });
          }
        } catch (error) {
          errors.push(error);
        }
      }
    };
    const workerCount = Math.min(this.maxConcurrency, pending.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    if (pending.length && errors.length === pending.length) throw errors[0];
    return routes;
  }
}
