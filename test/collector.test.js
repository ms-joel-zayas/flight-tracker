import test from "node:test";
import assert from "node:assert/strict";
import { FlightCollector } from "../backend/collector.js";

test("tracks first observation and an observed ground-to-air departure", async () => {
  let now = Date.parse("2026-10-14T12:00:00.000Z");
  let airborne = false;
  const snapshots = [];
  const provider = {
    fetchAircraft: async () => ({
      now,
      ac: [{
        hex: "A12AA1",
        flight: "UAL1783",
        lat: airborne ? 42.5 : 42,
        lon: -71,
        alt_baro: airborne ? 5000 : "ground",
        gs: airborne ? 120 : 0,
        track: 0,
        seen_pos: 0,
      }],
    }),
    fetchRoutes: async () => new Map([["UAL1783", {
      callsign: "UAL1783",
      origin: "AAA",
      destination: "BBB",
      waypoints: [
        { code: "AAA", latitude: 42, longitude: -71 },
        { code: "BBB", latitude: 43, longitude: -71 },
      ],
    }]]),
  };
  const historyStore = {
    recordSnapshot: (aircraft) => snapshots.push(aircraft),
    removePositionsBefore: () => 0,
  };
  const collector = new FlightCollector({
    config: {
      tracking: { latitude: 42, longitude: -71, radiusNm: 60 },
      staleAfterSeconds: 60,
      pollIntervalMs: 30_000,
      historyRetentionHours: 24,
      adsbLol: { routeCacheMs: 6 * 60 * 60 * 1000 },
    },
    adsbProvider: provider,
    historyStore,
    now: () => now,
  });

  await collector.collect();
  let aircraft = collector.getAircraft("a12aa1");
  assert.equal(aircraft.firstObservedAt, "2026-10-14T12:00:00.000Z");
  assert.equal(aircraft.departureTime, null);
  assert.equal(aircraft.eta, null);

  airborne = true;
  now += 30_000;
  await collector.collect();
  aircraft = collector.getAircraft("a12aa1");
  assert.equal(aircraft.departureTime, "2026-10-14T12:00:30.000Z");
  assert.equal(aircraft.departureTimeSource, "observed");
  assert.equal(aircraft.etaSource, "calculated");
  assert.equal(aircraft.progressPercent, 50);
  assert.match(aircraft.flightSessionId, /^a12aa1:UAL1783:/);
  assert.equal(snapshots.length, 2);
});

test("labels an aircraft first seen airborne without claiming an observed departure", async () => {
  const now = Date.parse("2026-10-14T12:00:00.000Z");
  const collector = new FlightCollector({
    config: {
      tracking: { latitude: 42, longitude: -71, radiusNm: 60 },
      staleAfterSeconds: 60,
      pollIntervalMs: 30_000,
      historyRetentionHours: 24,
      adsbLol: { routeCacheMs: 1000 },
    },
    adsbProvider: {
      fetchAircraft: async () => ({
        now,
        ac: [{ hex: "A12AA1", flight: "UAL1783", lat: 42.5, lon: -71, alt_baro: 5000, gs: 120 }],
      }),
      fetchRoutes: async () => new Map(),
    },
    historyStore: { recordSnapshot: () => {}, removePositionsBefore: () => 0 },
    now: () => now,
  });

  await collector.collect();
  const aircraft = collector.getAircraft("a12aa1");
  assert.equal(aircraft.departureTime, "2026-10-14T12:00:00.000Z");
  assert.equal(aircraft.departureTimeSource, "first-observed");
  assert.equal(aircraft.firstObservedAt, aircraft.departureTime);
});

test("reuses a persisted route cache after a server restart", async () => {
  const now = Date.parse("2026-10-14T12:00:00.000Z");
  let routeRequests = 0;
  const route = {
    callsign: "UAL1783",
    origin: "ORD",
    destination: "BOS",
    waypoints: [
      { code: "ORD", latitude: 41.9742, longitude: -87.9073 },
      { code: "BOS", latitude: 42.3656, longitude: -71.0096 },
    ],
  };
  const collector = new FlightCollector({
    config: {
      tracking: { latitude: 42, longitude: -71, radiusNm: 60 },
      staleAfterSeconds: 60,
      pollIntervalMs: 30_000,
      historyRetentionHours: 168,
      adsbLol: { routeCacheMs: 6 * 60 * 60 * 1000 },
    },
    adsbProvider: {
      fetchAircraft: async () => ({
        now,
        ac: [{ hex: "A12AA1", flight: "UAL1783", lat: 42.4, lon: -71.4, alt_baro: 5000, gs: 120 }],
      }),
      fetchRoutes: async () => {
        routeRequests += 1;
        return new Map();
      },
    },
    historyStore: {
      getRouteCache: () => ({ route, expiresAt: now + 60_000 }),
      recordSnapshot: () => {},
      removePositionsBefore: () => 0,
    },
    now: () => now,
  });

  await collector.collect();
  assert.equal(routeRequests, 0);
  assert.equal(collector.getAircraft("a12aa1").origin, "ORD");
});

test("backs off collection after an upstream rate-limit response", async () => {
  let now = Date.parse("2026-10-14T12:00:00.000Z");
  let requests = 0;
  const provider = {
    fetchAircraft: async () => {
      requests += 1;
      if (requests === 1) {
        const error = new Error("ADSB.lol returned HTTP 429");
        error.retryAfterMs = 120_000;
        throw error;
      }
      return { now, ac: [] };
    },
    fetchRoutes: async () => new Map(),
  };
  const collector = new FlightCollector({
    config: {
      tracking: { latitude: 42, longitude: -71, radiusNm: 60 },
      staleAfterSeconds: 60,
      pollIntervalMs: 30_000,
      historyRetentionHours: 168,
      adsbLol: { routeCacheMs: 6 * 60 * 60 * 1000 },
    },
    adsbProvider: provider,
    historyStore: { recordSnapshot: () => {}, removePositionsBefore: () => 0 },
    logger: { warn: () => {} },
    now: () => now,
    random: () => 0,
  });

  await collector.collect();
  assert.equal(requests, 1);
  assert.equal(collector.getSnapshot().meta.consecutiveFailures, 1);
  assert.equal(collector.getSnapshot().meta.nextRetryAt, "2026-10-14T12:02:00.000Z");

  now += 30_000;
  await collector.collect();
  assert.equal(requests, 1);

  now += 90_000;
  await collector.collect();
  assert.equal(requests, 2);
  assert.equal(collector.getSnapshot().meta.status, "live");
  assert.equal(collector.getSnapshot().meta.nextRetryAt, null);
});
