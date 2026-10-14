import test from "node:test";
import assert from "node:assert/strict";
import {
  applyRoute,
  detectEmergency,
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

