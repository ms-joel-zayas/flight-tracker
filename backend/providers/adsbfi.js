const REQUEST_TIMEOUT_MS = 10_000;

function retryAfterMilliseconds(response, nowMs = Date.now()) {
  const value = response.headers.get("retry-after");
  if (!value) return null;
  if (/^\d+(\.\d+)?$/.test(value.trim())) return Math.max(0, Number(value) * 1000);
  const retryAt = Date.parse(value);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - nowMs) : null;
}

export class AdsbFiProvider {
  constructor({
    baseUrl,
    userAgent,
    fetchImpl = globalThis.fetch,
  }) {
    this.name = "adsb.fi";
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.userAgent = userAgent;
    this.fetch = fetchImpl;
  }

  async fetchAircraft({ latitude, longitude, radiusNm }) {
    const url = `${this.baseUrl}/v3/lat/${latitude}/lon/${longitude}/dist/${radiusNm}`;
    const response = await this.fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": this.userAgent,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = new Error(`ADSB.fi returned HTTP ${response.status}`);
      error.statusCode = response.status;
      error.retryAfterMs = retryAfterMilliseconds(response);
      throw error;
    }

    const payload = await response.json();
    if (!payload || !Array.isArray(payload.ac)) {
      throw new Error("ADSB.fi returned an unexpected aircraft response");
    }
    return payload;
  }
}
