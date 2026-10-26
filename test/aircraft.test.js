import test from "node:test";
import assert from "node:assert/strict";
import {
  applyDerivedFlightData,
  applyRoute,
  detectEmergency,
  greatCircleDistanceNm,
  normalizeAdsbAircraft,
} from "../backend/aircraft.js";

test("normalizes ADSB.lol aircraft into the frontend contract", () => {
  const providerTime = Date.parse("2026-10-14T15:30:00Z");
  const aircraft = normalizeAdsbAircraft({
    hex: "A12AA1",
    flight: " UAL1783 ",
    r: "N17414",
    t: "B39M",
    lat: 42.403839,
    lon: -71.412444,
    alt_baro: 10475,
    gs: 271,
    track: 141.14,
    baro_rate: -1472,
    squawk: "7342",
    emergency: "none",
    seen_pos: 2.5,
  }, providerTime, 60);

  assert.equal(aircraft.id, "a12aa1");
  assert.equal(aircraft.callsign, "UAL1783");
  assert.equal(aircraft.tailNumber, "N17414");
  assert.equal(aircraft.altitudeFeet, 10475);
  assert.equal(aircraft.observedAt, "2026-10-14T15:29:57.500Z");
  assert.equal(aircraft.stale, false);
  assert.equal(aircraft.emergency, null);
});

test("detects standard emergency squawks", () => {
  assert.deepEqual(detectEmergency({ squawk: "7700", emergency: "none" }), {
    code: "7700",
    reason: "General emergency",
  });
  assert.deepEqual(detectEmergency({ squawk: "1200", emergency: "general" }), {
    code: "general",
    reason: "general",
  });
});

test("adds a cached route without mutating the aircraft", () => {
  const aircraft = { origin: null, destination: null };
  const result = applyRoute(aircraft, {
    origin: "BOS",
    destination: "ORD",
    source: "adsb.lol-routeset",
  });

  assert.equal(aircraft.origin, null);
  assert.equal(result.origin, "BOS");
  assert.equal(result.destination, "ORD");
});

test("calculates route progress, remaining distance, and ETA", () => {
  const capturedAt = Date.parse("2026-10-14T12:00:00.000Z");
  const aircraft = applyRoute({
    latitude: 42.5,
    longitude: -71,
    speedKnots: 120,
    onGround: false,
  }, {
    origin: "AAA",
    destination: "BBB",
    waypoints: [
      { code: "AAA", latitude: 42, longitude: -71 },
      { code: "BBB", latitude: 43, longitude: -71 },
    ],
  });

  const result = applyDerivedFlightData(aircraft, capturedAt);
  assert.equal(result.progressPercent, 50);
  assert.ok(result.remainingDistanceNm > 29 && result.remainingDistanceNm < 31);
  assert.equal(result.etaSource, "calculated");
  const etaMinutes = (Date.parse(result.eta) - capturedAt) / 60_000;
  assert.ok(etaMinutes > 14 && etaMinutes < 16);
  assert.ok(greatCircleDistanceNm(
    { latitude: 42, longitude: -71 },
    { latitude: 43, longitude: -71 },
  ) > 59);
});

test("does not calculate an ETA without a usable airborne speed", () => {
  const result = applyDerivedFlightData({
    latitude: 42.5,
    longitude: -71,
    speedKnots: 0,
    onGround: true,
    origin: "AAA",
    destination: "BBB",
    route: {
      waypoints: [
        { code: "AAA", latitude: 42, longitude: -71 },
        { code: "BBB", latitude: 43, longitude: -71 },
      ],
    },
  });
  assert.equal(result.eta, null);
  assert.equal(result.etaSource, null);
});
