import { applyDerivedFlightData, applyRoute, normalizeAdsbAircraft } from "./aircraft.js";

const SESSION_EXPIRY_MS = 30 * 60 * 1000;
const RECENT_SPEED_SAMPLES = 5;
const MAX_COLLECTION_BACKOFF_MS = 15 * 60 * 1000;
const ROUTE_ERROR_CACHE_MS = 5 * 60 * 1000;

function isoOrNull(timestamp) {
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export class FlightCollector {
  constructor({
    config,
    adsbProvider,
    historyStore,
    logger = console,
    now = Date.now,
    random = Math.random,
  }) {
    this.config = config;
    this.adsbProvider = adsbProvider;
    this.historyStore = historyStore;
    this.logger = logger;
    this.now = now;
    this.random = random;
    this.aircraft = [];
    this.routeCache = new Map();
    this.flightSessions = new Map();
    this.lastSuccessfulFetchMs = null;
    this.providerTimestampMs = null;
    this.positionProvider = adsbProvider.name || "adsb.lol";
    this.lastError = null;
    this.routeWarning = null;
    this.collecting = false;
    this.consecutiveFailures = 0;
    this.nextCollectionAttemptMs = 0;
    this.timer = null;
    this.routeEnrichmentTask = null;
    this.stopped = false;
  }

  async start() {
    this.stopped = false;
    await this.collect();
    this.timer = setInterval(() => this.collect(), this.config.pollIntervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stopped = true;
  }

  async collect() {
    const attemptStartedAtMs = this.now();
    if (this.collecting || attemptStartedAtMs < this.nextCollectionAttemptMs) return;
    this.collecting = true;

    try {
      const payload = await this.adsbProvider.fetchAircraft(this.config.tracking);
      const capturedAtMs = this.now();
      const providerTimestampMs = Number.isFinite(Number(payload.now))
        ? Number(payload.now)
        : capturedAtMs;
      const positionProvider = typeof payload.provider === "string"
        ? payload.provider
        : this.adsbProvider.name || "adsb.lol";
      let aircraft = payload.ac
        .map((rawAircraft) => normalizeAdsbAircraft(
          rawAircraft,
          providerTimestampMs,
          this.config.staleAfterSeconds,
          positionProvider,
        ))
        .filter(Boolean);

      aircraft = this.applyCachedRoutes(aircraft, capturedAtMs);
      aircraft = this.addObservedFlightData(aircraft, capturedAtMs);
      this.historyStore.recordSnapshot(aircraft, capturedAtMs);
      const retentionMs = this.config.historyRetentionHours * 60 * 60 * 1000;
      this.historyStore.removePositionsBefore(capturedAtMs - retentionMs);

      this.aircraft = aircraft;
      this.providerTimestampMs = providerTimestampMs;
      this.positionProvider = positionProvider;
      this.lastSuccessfulFetchMs = capturedAtMs;
      this.lastError = null;
      this.consecutiveFailures = 0;
      this.nextCollectionAttemptMs = 0;
      this.scheduleRouteEnrichment(aircraft, capturedAtMs);
    } catch (error) {
      this.lastError = error.message;
      this.consecutiveFailures += 1;
      const exponentialDelayMs = Math.min(
        this.config.pollIntervalMs * 2 ** (this.consecutiveFailures - 1),
        MAX_COLLECTION_BACKOFF_MS,
      );
      const requestedDelayMs = Number.isFinite(error.retryAfterMs) ? error.retryAfterMs : 0;
      const baseDelayMs = Math.max(exponentialDelayMs, requestedDelayMs);
      const jitterMs = Math.round(baseDelayMs * 0.1 * this.random());
      this.nextCollectionAttemptMs = attemptStartedAtMs + baseDelayMs + jitterMs;
      this.logger.warn(
        `Live aircraft update failed: ${error.message}; retrying after ${Math.round((baseDelayMs + jitterMs) / 1000)}s`,
      );
    } finally {
      this.collecting = false;
    }
  }

  applyCachedRoutes(aircraft, timestampMs) {
    return aircraft.map((item) => applyRoute(
      item,
      item.callsign ? this.getCachedRoute(item.callsign, timestampMs)?.route : null,
    ));
  }

  scheduleRouteEnrichment(aircraft, capturedAtMs) {
    if (this.routeEnrichmentTask || this.stopped) return;

    const task = (async () => {
      try {
        const routedAircraft = await this.addRoutes(aircraft, capturedAtMs);
        if (this.stopped || this.lastSuccessfulFetchMs !== capturedAtMs) return;

        this.aircraft = routedAircraft.map((item) => {
          const recentSpeeds = this.flightSessions.get(item.id)?.recentSpeeds || [];
          const recentSpeedKnots = recentSpeeds.length
            ? recentSpeeds.reduce((sum, speed) => sum + speed, 0) / recentSpeeds.length
            : item.speedKnots;
          return applyDerivedFlightData(item, capturedAtMs, recentSpeedKnots);
        });
      } catch (error) {
        this.routeWarning = error.message;
        this.logger.warn(`Aircraft route update failed: ${error.message}`);
      }
    })();

    this.routeEnrichmentTask = task;
    void task.finally(() => {
      if (this.routeEnrichmentTask === task) this.routeEnrichmentTask = null;
    });
  }

  async waitForRouteEnrichment() {
    await this.routeEnrichmentTask;
  }

  async addRoutes(aircraft, timestampMs) {
    const missingRoutes = aircraft.filter((item) => {
      if (!item.callsign) return false;
      return !this.getCachedRoute(item.callsign, timestampMs);
    });

    if (missingRoutes.length) {
      try {
        const routes = await this.adsbProvider.fetchRoutes(missingRoutes);
        for (const item of missingRoutes.slice(0, 100)) {
          this.cacheRoute(
            item.callsign,
            routes.get(item.callsign) || null,
            timestampMs + this.config.adsbLol.routeCacheMs,
            timestampMs,
          );
        }
        this.routeWarning = null;
      } catch (error) {
        this.routeWarning = error.message;
        for (const item of missingRoutes.slice(0, 100)) {
          this.cacheRoute(
            item.callsign,
            null,
            timestampMs + Math.min(ROUTE_ERROR_CACHE_MS, this.config.adsbLol.routeCacheMs),
            timestampMs,
          );
        }
        this.logger.warn(`Aircraft route update failed: ${error.message}`);
      }
    }

    return this.applyCachedRoutes(aircraft, timestampMs);
  }

  getCachedRoute(callsign, timestampMs) {
    const normalized = callsign.toUpperCase();
    const memoryCached = this.routeCache.get(normalized);
    if (memoryCached?.expiresAt > timestampMs) return memoryCached;
    this.routeCache.delete(normalized);

    const persisted = this.historyStore.getRouteCache?.(normalized, timestampMs) || null;
    if (persisted) this.routeCache.set(normalized, persisted);
    return persisted;
  }

  cacheRoute(callsign, route, expiresAt, updatedAt) {
    const normalized = callsign.toUpperCase();
    const cached = { route, expiresAt };
    this.routeCache.set(normalized, cached);
    this.historyStore.setRouteCache?.(normalized, route, expiresAt, updatedAt);
  }

  addObservedFlightData(aircraft, capturedAtMs) {
    const activeIds = new Set(aircraft.map((item) => item.id));
    const enriched = aircraft.map((item) => {
      let session = this.flightSessions.get(item.id);
      const callsignChanged = session
        && session.callsign !== item.callsign
        && Boolean(session.callsign || item.callsign);
      const sessionExpired = session && capturedAtMs - session.lastSeenAtMs > SESSION_EXPIRY_MS;
      if (!session || callsignChanged || sessionExpired) {
        session = {
          callsign: item.callsign,
          flightSessionId: `${item.id}:${item.callsign || "unknown"}:${capturedAtMs}`,
          firstObservedAt: item.observedAt,
          departureTime: item.onGround ? null : item.observedAt,
          departureTimeSource: item.onGround ? null : "first-observed",
          wasOnGround: item.onGround,
          lastSeenAtMs: capturedAtMs,
          recentSpeeds: [],
        };
        this.flightSessions.set(item.id, session);
      } else {
        if (!session.departureTime && session.wasOnGround && !item.onGround) {
          session.departureTime = item.observedAt;
          session.departureTimeSource = "observed";
        }
        session.callsign = item.callsign || session.callsign;
        session.wasOnGround = item.onGround;
        session.lastSeenAtMs = capturedAtMs;
      }

      if (!item.onGround && Number.isFinite(item.speedKnots) && item.speedKnots >= 30) {
        session.recentSpeeds.push(item.speedKnots);
        session.recentSpeeds = session.recentSpeeds.slice(-RECENT_SPEED_SAMPLES);
      }
      const recentSpeedKnots = session.recentSpeeds.length
        ? session.recentSpeeds.reduce((sum, speed) => sum + speed, 0) / session.recentSpeeds.length
        : item.speedKnots;
      return applyDerivedFlightData({
        ...item,
        flightSessionId: session.flightSessionId,
        firstObservedAt: session.firstObservedAt,
        departureTime: session.departureTime,
        departureTimeSource: session.departureTimeSource,
      }, capturedAtMs, recentSpeedKnots);
    });

    for (const [id, session] of this.flightSessions) {
      if (!activeIds.has(id) && capturedAtMs - session.lastSeenAtMs > SESSION_EXPIRY_MS) {
        this.flightSessions.delete(id);
      }
    }
    return enriched;
  }

  getSnapshot() {
    const nowMs = this.now();
    const updateAgeSeconds = this.lastSuccessfulFetchMs === null
      ? null
      : Math.max(0, (nowMs - this.lastSuccessfulFetchMs) / 1000);
    const feedIsStale = updateAgeSeconds === null
      || updateAgeSeconds > this.config.staleAfterSeconds;
    const aircraft = this.aircraft.map((item) => ({
      ...item,
      stale: item.stale || feedIsStale,
    }));

    return {
      meta: {
        status: this.lastSuccessfulFetchMs === null
          ? "starting"
          : feedIsStale || this.lastError
            ? "degraded"
            : "live",
        provider: this.positionProvider,
        updatedAt: isoOrNull(this.lastSuccessfulFetchMs),
        providerTimestamp: isoOrNull(this.providerTimestampMs),
        updateAgeSeconds,
        refreshIntervalSeconds: this.config.pollIntervalMs / 1000,
        staleAfterSeconds: this.config.staleAfterSeconds,
        total: aircraft.length,
        region: this.config.tracking,
        warning: this.lastError || this.routeWarning,
        consecutiveFailures: this.consecutiveFailures,
        nextRetryAt: this.nextCollectionAttemptMs
          ? isoOrNull(this.nextCollectionAttemptMs)
          : null,
      },
      aircraft,
    };
  }

  getAircraft(aircraftId) {
    return this.getSnapshot().aircraft.find(
      (item) => item.id === aircraftId.toLowerCase(),
    ) || null;
  }
}
