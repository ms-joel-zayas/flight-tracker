const REQUEST_TIMEOUT_MS = 10_000;

function textOrNull(value) {
  if (typeof value !== "string") return null;
  return value.trim() || null;
}

function utcDateOrNull(value) {
  const text = textOrNull(value);
  if (!text) return null;

  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(text)
    ? `${text.replace(" ", "T")}Z`
    : text;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function normalizeAirLabsFlight(rawFlight) {
  if (!rawFlight || typeof rawFlight !== "object") return null;

  return {
    callsign: textOrNull(rawFlight.flight_icao)?.toUpperCase() || null,
    flightNumber: textOrNull(rawFlight.flight_iata)?.toUpperCase()
      || textOrNull(rawFlight.flight_icao)?.toUpperCase()
      || null,
    tailNumber: textOrNull(rawFlight.reg_number)?.toUpperCase() || null,
    origin: textOrNull(rawFlight.dep_iata)?.toUpperCase()
      || textOrNull(rawFlight.dep_icao)?.toUpperCase()
      || null,
    destination: textOrNull(rawFlight.arr_iata)?.toUpperCase()
      || textOrNull(rawFlight.arr_icao)?.toUpperCase()
      || null,
    departureTime: utcDateOrNull(rawFlight.dep_estimated_utc)
      || utcDateOrNull(rawFlight.dep_time_utc),
    eta: utcDateOrNull(rawFlight.arr_estimated_utc)
      || utcDateOrNull(rawFlight.arr_time_utc),
    status: textOrNull(rawFlight.status),
    updatedAt: Number.isFinite(Number(rawFlight.updated))
      ? new Date(Number(rawFlight.updated) * 1000).toISOString()
      : null,
    source: "airlabs",
  };
}

export class AirLabsProvider {
  constructor({ baseUrl, apiKey = "", fetchImpl = globalThis.fetch }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
  }

  get enabled() {
    return Boolean(this.apiKey);
  }

  async fetchFlight(callsign) {
    if (!this.enabled) return null;

    const flightIcao = String(callsign || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
    if (!flightIcao) return null;

    const url = new URL(`${this.baseUrl}/flight`);
    url.searchParams.set("flight_icao", flightIcao);
    url.searchParams.set(
      "_fields",
      "flight_icao,flight_iata,reg_number,dep_iata,dep_icao,dep_time_utc,dep_estimated_utc,arr_iata,arr_icao,arr_time_utc,arr_estimated_utc,status,updated",
    );
    url.searchParams.set("api_key", this.apiKey);

    const response = await this.fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`AirLabs returned HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (payload?.error) {
      throw new Error(`AirLabs error: ${payload.error.message || payload.error.code || "unknown error"}`);
    }

    const rawFlight = Array.isArray(payload?.response) ? payload.response[0] : payload?.response;
    return normalizeAirLabsFlight(rawFlight);
  }
}

