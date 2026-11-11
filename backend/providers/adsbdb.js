import { greatCircleDistanceNm } from "../aircraft.js";

const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_DETAIL_CACHE_MS = 6 * 60 * 60 * 1000;
const MIN_ROUTE_DISTANCE_NM = 1;
const MIN_ROUTE_ALLOWANCE_NM = 100;
const ROUTE_ALLOWANCE_RATIO = 0.2;

function retryAfterMilliseconds(response, nowMs = Date.now()) {
  const value = response.headers.get("retry-after");
  if (!value) return null;
  if (/^\d+(\.\d+)?$/.test(value.trim())) return Math.max(0, Number(value) * 1000);
  const retryAt = Date.parse(value);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - nowMs) : null;
}

function normalizedCallsign(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function normalizedModeS(value) {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  return /^[A-F0-9]{6}$/.test(normalized) ? normalized : "";
}

function textOrNull(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
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

function normalizeAirline(airline) {
  if (!airline || typeof airline !== "object") return null;
  const name = textOrNull(airline.name);
  const icao = textOrNull(airline.icao)?.toUpperCase() || null;
  const iata = textOrNull(airline.iata)?.toUpperCase() || null;
  if (!name && !icao && !iata) return null;
  return {
    name,
    icao,
    iata,
    country: textOrNull(airline.country),
  };
}

export function normalizeAdsbDbAircraft(payload) {
  const rawAircraft = payload?.response?.aircraft || payload?.aircraft || payload;
  if (!rawAircraft || typeof rawAircraft !== "object") return null;

  const id = normalizedModeS(rawAircraft.mode_s);
  const tailNumber = textOrNull(rawAircraft.registration)?.toUpperCase() || null;
  if (!id && !tailNumber) return null;

  return {
    id: id ? id.toLowerCase() : null,
    tailNumber,
    aircraftType: textOrNull(rawAircraft.icao_type)?.toUpperCase() || null,
    aircraftModel: textOrNull(rawAircraft.type),
    manufacturer: textOrNull(rawAircraft.manufacturer),
    registeredOwner: textOrNull(rawAircraft.registered_owner),
    registeredCountry: textOrNull(rawAircraft.registered_owner_country_name),
    source: "adsbdb",
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
    airline: normalizeAirline(rawRoute.airline),
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
    detailCacheMs = DEFAULT_DETAIL_CACHE_MS,
    fetchImpl = globalThis.fetch,
    now = Date.now,
  }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.userAgent = userAgent;
    this.maxConcurrency = maxConcurrency;
    this.detailCacheMs = detailCacheMs;
    this.fetch = fetchImpl;
    this.now = now;
    this.detailCache = new Map();
  }

  async request(path) {
    const response = await this.fetch(
      `${this.baseUrl}${path}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": this.userAgent,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (response.status === 404) return null;
    if (!response.ok) {
      const error = new Error(`ADSBDB returned HTTP ${response.status}`);
      error.statusCode = response.status;
      error.retryAfterMs = retryAfterMilliseconds(response);
      throw error;
    }
    return response.json();
  }

  async fetchRoute(callsign) {
    const normalized = normalizedCallsign(callsign);
    if (!/^[A-Z0-9]{2,10}$/.test(normalized)) return null;

    const payload = await this.request(`/v0/callsign/${encodeURIComponent(normalized)}`);
    return payload ? normalizeAdsbDbRoute(payload) : null;
  }

  async fetchAircraftDetails(aircraft) {
    const modeS = normalizedModeS(aircraft?.aircraftId || aircraft?.id);
    if (!modeS) return null;

    const callsign = normalizedCallsign(aircraft?.callsign);
    const usableCallsign = /^[A-Z0-9]{2,10}$/.test(callsign) ? callsign : "";
    const cacheKey = `${modeS}:${usableCallsign}`;
    const cached = this.detailCache.get(cacheKey);
    if (cached?.expiresAt > this.now()) {
      return cached.value ? { ...cached.value, cache: "cache" } : null;
    }
    this.detailCache.delete(cacheKey);

    const query = usableCallsign ? `?callsign=${encodeURIComponent(usableCallsign)}` : "";
    const payload = await this.request(`/v0/aircraft/${modeS}${query}`);
    if (!payload) {
      this.detailCache.set(cacheKey, {
        value: null,
        expiresAt: this.now() + this.detailCacheMs,
      });
      return null;
    }

    const identity = normalizeAdsbDbAircraft(payload);
    const candidateRoute = usableCallsign ? normalizeAdsbDbRoute(payload) : null;
    const route = candidateRoute && isAdsbDbRoutePlausible(candidateRoute, aircraft)
      ? { ...candidateRoute, plausible: true }
      : null;
    const value = identity || route
      ? {
          ...identity,
          route,
          operator: route?.airline?.name || null,
        }
      : null;
    this.detailCache.set(cacheKey, {
      value,
      expiresAt: this.now() + this.detailCacheMs,
    });
    return value ? { ...value, cache: "live" } : null;
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
