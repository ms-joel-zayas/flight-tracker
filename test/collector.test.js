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
