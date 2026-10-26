import test from "node:test";
import assert from "node:assert/strict";
import {
  aircraftName,
  buildTimeWindow,
  collectAirports,
  formatAge,
  projectPosition,
  projectedAircraft,
} from "../js/api.js";

const region = { latitude: 42, longitude: -71, radiusNm: 60 };

test("projects live latitude and longitude into the SVG map", () => {
  assert.deepEqual(projectPosition(42, -71, region), { x: 50, y: 50 });
  assert.equal(projectPosition(43, -71, region).y, 0);

  const eastLongitude = -71 + 1 / Math.cos(42 * Math.PI / 180);
  assert.ok(Math.abs(projectPosition(42, eastLongitude, region).x - 100) < 0.0001);
  assert.equal(projectPosition(null, -71, region), null);
});

test("decorates aircraft and derives route airport map points", () => {
  const aircraft = {
    id: "a12aa1",
    callsign: "UAL1783",
    latitude: 42,
    longitude: -71,
    route: {
      waypoints: [
        { code: "BOS", latitude: 42.5, longitude: -71 },
        { code: "ORD", latitude: 41.9, longitude: -87.9 },
      ],
    },
  };

  assert.equal(aircraftName(aircraft), "UAL1783");
  assert.equal(projectedAircraft(aircraft, region).x, 50);
  const airports = collectAirports([aircraft], region);
  assert.equal(airports.get("BOS").code, "BOS");
  assert.ok(Number.isFinite(airports.get("ORD").x));
});

test("builds deterministic history windows and readable update ages", () => {
  const now = Date.parse("2026-10-26T12:00:00.000Z");
  const window = buildTimeWindow(60_000, now);
  assert.equal(window.get("from"), "2026-10-26T11:59:00.000Z");
  assert.equal(window.get("to"), "2026-10-26T12:00:00.000Z");
  assert.equal(formatAge(12.2), "updated 12s ago");
  assert.equal(formatAge(121), "updated 2m ago");
});
