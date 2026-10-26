const REQUEST_TIMEOUT_MS = 10_000;

function normalizedCallsign(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function airportCode(airport) {
  return airport?.iata || airport?.iata_code || airport?.icao || airport?.icao_code || airport?.code || null;
}

function coordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeAdsbLolRoute(rawRoute) {
  if (!rawRoute || typeof rawRoute !== "object") return null;
  if (rawRoute.plausible === false) return null;

  const callsign = normalizedCallsign(rawRoute.callsign);
  const airports = Array.isArray(rawRoute._airports)
    ? rawRoute._airports.map((airport) => ({
        code: airportCode(airport),
        iata: airport?.iata || airport?.iata_code || null,
        icao: airport?.icao || airport?.icao_code || null,
        name: airport?.name || null,
        latitude: coordinate(airport?.lat ?? airport?.latitude),
        longitude: coordinate(airport?.lon ?? airport?.lng ?? airport?.longitude),
      }))
    : [];

  const listedCodes = typeof rawRoute.airport_codes === "string" && rawRoute.airport_codes !== "unknown"
    ? rawRoute.airport_codes.split(/[-–—>]/).map((code) => code.trim()).filter(Boolean)
    : [];
  const codes = airports.map((airport) => airport.code).filter(Boolean);
  const routeCodes = codes.length ? codes : listedCodes;

  if (!callsign || routeCodes.length < 2) return null;

  return {
    callsign,
    origin: routeCodes[0],
    destination: routeCodes.at(-1),
    airportCodes: routeCodes,
    waypoints: airports,
    plausible: rawRoute.plausible !== false,
    source: "adsb.lol-routeset",
  };
}

export class AdsbLolProvider {
  constructor({
    baseUrl,
    apiToken = "",
    userAgent,
    routeFallback = null,
    fetchImpl = globalThis.fetch,
  }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiToken = apiToken;
    this.userAgent = userAgent;
    this.routeFallback = routeFallback;
    this.fetch = fetchImpl;
  }

  headers(extra = {}) {
    const headers = {
      Accept: "application/json",
      "User-Agent": this.userAgent,
      ...extra,
    };
    if (this.apiToken) headers.Authorization = `Bearer ${this.apiToken}`;
    return headers;
  }

  async requestJson(url, options = {}) {
    const response = await this.fetch(url, {
      ...options,
      headers: this.headers(options.headers),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`ADSB.lol returned HTTP ${response.status}`);
    }

    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  async fetchAircraft({ latitude, longitude, radiusNm }) {
    const url = `${this.baseUrl}/v2/point/${latitude}/${longitude}/${radiusNm}`;
    const payload = await this.requestJson(url);

    if (!payload || !Array.isArray(payload.ac)) {
      throw new Error("ADSB.lol returned an unexpected aircraft response");
    }
    return payload;
  }

  async fetchRoutes(aircraft) {
    const planes = aircraft
      .filter((item) => item.callsign && Number.isFinite(item.latitude) && Number.isFinite(item.longitude))
      .slice(0, 100)
      .map((item) => ({
        callsign: item.callsign,
        lat: item.latitude,
        lng: item.longitude,
      }));

    if (!planes.length) return new Map();

    let payload = null;
    let primaryError = null;
    try {
      payload = await this.requestJson(`${this.baseUrl}/api/0/routeset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planes }),
      });
    } catch (error) {
      primaryError = error;
    }

    const routes = new Map();
    for (const rawRoute of Array.isArray(payload) ? payload : []) {
      const route = normalizeAdsbLolRoute(rawRoute);
      if (route) routes.set(route.callsign, route);
    }

    if (this.routeFallback) {
      const unresolvedCallsigns = new Set(
        planes.map((plane) => normalizedCallsign(plane.callsign)).filter((callsign) => !routes.has(callsign)),
      );
      const unresolvedAircraft = aircraft.filter((item) => (
        unresolvedCallsigns.has(normalizedCallsign(item.callsign))
      ));
      if (unresolvedAircraft.length) {
        try {
          const fallbackRoutes = await this.routeFallback.fetchRoutes(unresolvedAircraft);
          for (const [callsign, route] of fallbackRoutes) routes.set(callsign, route);
        } catch (fallbackError) {
          if (!routes.size) {
            const primaryMessage = primaryError ? `${primaryError.message}; ` : "";
            throw new Error(`${primaryMessage}ADSBDB fallback failed: ${fallbackError.message}`);
          }
        }
      }
    } else if (primaryError) {
      throw primaryError;
    }
    return routes;
  }
}
