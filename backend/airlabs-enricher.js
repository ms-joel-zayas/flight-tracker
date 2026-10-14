function utcDay(timestamp = Date.now()) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export class AirLabsEnricher {
  constructor({ provider, store, cacheMs, dailyRequestLimit, now = Date.now }) {
    this.provider = provider;
    this.store = store;
    this.cacheMs = cacheMs;
    this.dailyRequestLimit = dailyRequestLimit;
    this.now = now;
    this.cache = new Map();
  }

  get enabled() {
    return this.provider.enabled && this.dailyRequestLimit > 0;
  }

  async enrich(aircraft) {
    if (!this.enabled) {
      return {
        ...aircraft,
        enrichment: { airLabs: "disabled" },
      };
    }
    if (!aircraft.callsign) {
      return {
        ...aircraft,
        enrichment: { airLabs: "unavailable", reason: "Aircraft has no callsign" },
      };
    }

    const cacheKey = aircraft.callsign.toUpperCase();
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > this.now()) {
      return this.merge(aircraft, cached.value, "cache");
    }

    const day = utcDay(this.now());
    const used = this.store.getProviderUsage("airlabs", day);
    if (used >= this.dailyRequestLimit) {
      return {
        ...aircraft,
        enrichment: {
          airLabs: "daily-limit-reached",
          requestsUsedToday: used,
          dailyRequestLimit: this.dailyRequestLimit,
        },
      };
    }

    this.store.countProviderRequest("airlabs", day);
    try {
      const flight = await this.provider.fetchFlight(aircraft.callsign);
      this.cache.set(cacheKey, {
        value: flight,
        expiresAt: this.now() + this.cacheMs,
      });
      return this.merge(aircraft, flight, "live");
    } catch (error) {
      return {
        ...aircraft,
        enrichment: { airLabs: "error", message: error.message },
      };
    }
  }

  merge(aircraft, flight, cacheStatus) {
    if (!flight) {
      return {
        ...aircraft,
        enrichment: { airLabs: "no-match", cache: cacheStatus },
      };
    }

    return {
      ...aircraft,
      flightNumber: flight.flightNumber || aircraft.flightNumber,
      tailNumber: flight.tailNumber || aircraft.tailNumber,
      origin: flight.origin || aircraft.origin,
      destination: flight.destination || aircraft.destination,
      eta: flight.eta || aircraft.eta,
      etaSource: flight.eta ? "airlabs" : aircraft.etaSource,
      departureTime: flight.departureTime,
      status: flight.status || aircraft.status,
      enrichment: {
        airLabs: "available",
        cache: cacheStatus,
        updatedAt: flight.updatedAt,
      },
    };
  }
}

