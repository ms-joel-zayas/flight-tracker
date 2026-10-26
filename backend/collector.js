import { applyDerivedFlightData, applyRoute, normalizeAdsbAircraft } from "./aircraft.js";

const SESSION_EXPIRY_MS = 30 * 60 * 1000;
const RECENT_SPEED_SAMPLES = 5;

function isoOrNull(timestamp) {
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export class FlightCollector {
  constructor({ config, adsbProvider, historyStore, logger = console, now = Date.now }) {
    this.config = config;
    this.adsbProvider = adsbProvider;
    this.historyStore = historyStore;
    this.logger = logger;
    this.now = now;
    this.aircraft = [];
    this.routeCache = new Map();
    this.flightSessions = new Map();
    this.lastSuccessfulFetchMs = null;
    this.providerTimestampMs = null;
    this.lastError = null;
    this.routeWarning = null;
    this.collecting = false;
    this.timer = null;
  }

  async start() {
    await this.collect();
    this.timer = setInterval(() => this.collect(), this.config.pollIntervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async collect() {
    if (this.collecting) return;
    this.collecting = true;

    try {
      const payload = await this.adsbProvider.fetchAircraft(this.config.tracking);
      const capturedAtMs = this.now();
      const providerTimestampMs = Number.isFinite(Number(payload.now))
        ? Number(payload.now)
        : capturedAtMs;
      let aircraft = payload.ac
        .map((rawAircraft) => normalizeAdsbAircraft(
          rawAircraft,
          providerTimestampMs,
          this.config.staleAfterSeconds,
        ))
        .filter(Boolean);

      aircraft = await this.addRoutes(aircraft, capturedAtMs);
      aircraft = this.addObservedFlightData(aircraft, capturedAtMs);
      this.historyStore.recordSnapshot(aircraft, capturedAtMs);
      const retentionMs = this.config.historyRetentionHours * 60 * 60 * 1000;
      this.historyStore.removePositionsBefore(capturedAtMs - retentionMs);

      this.aircraft = aircraft;
      this.providerTimestampMs = providerTimestampMs;
      this.lastSuccessfulFetchMs = capturedAtMs;
      this.lastError = null;
    } catch (error) {
      this.lastError = error.message;
      this.logger.warn(`Live aircraft update failed: ${error.message}`);
    } finally {
      this.collecting = false;
    }
  }

  async addRoutes(aircraft, timestampMs) {
    const missingRoutes = aircraft.filter((item) => {
      if (!item.callsign) return false;
      const cached = this.routeCache.get(item.callsign);
      return !cached || cached.expiresAt <= timestampMs;
    });

    if (missingRoutes.length) {
      try {
        const routes = await this.adsbProvider.fetchRoutes(missingRoutes);
        for (const item of missingRoutes.slice(0, 100)) {
          this.routeCache.set(item.callsign, {
            route: routes.get(item.callsign) || null,
            expiresAt: timestampMs + this.config.adsbLol.routeCacheMs,
          });
        }
        this.routeWarning = null;
      } catch (error) {
        this.routeWarning = error.message;
        this.logger.warn(`Aircraft route update failed: ${error.message}`);
      }
    }

    return aircraft.map((item) => applyRoute(
      item,
      item.callsign ? this.routeCache.get(item.callsign)?.route : null,
    ));
  }

  addObservedFlightData(aircraft, capturedAtMs) {
    const activeIds = new Set(aircraft.map((item) => item.id));
    const enriched = aircraft.map((item) => {
      let session = this.flightSessions.get(item.id);
      const callsignChanged = session?.callsign && item.callsign && session.callsign !== item.callsign;
      const sessionExpired = session && capturedAtMs - session.lastSeenAtMs > SESSION_EXPIRY_MS;
      if (!session || callsignChanged || sessionExpired) {
        session = {
          callsign: item.callsign,
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
        provider: "adsb.lol",
        updatedAt: isoOrNull(this.lastSuccessfulFetchMs),
        providerTimestamp: isoOrNull(this.providerTimestampMs),
        updateAgeSeconds,
        refreshIntervalSeconds: this.config.pollIntervalMs / 1000,
        staleAfterSeconds: this.config.staleAfterSeconds,
        total: aircraft.length,
        region: this.config.tracking,
        warning: this.lastError || this.routeWarning,
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
