import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { HistoryStore } from "../backend/database.js";

test("stores position history and provider request counts", () => {
  const store = new HistoryStore(":memory:");
  const capturedAt = Date.parse("2026-10-14T15:30:00Z");

  store.recordSnapshot([{
    id: "a12aa1",
    flightSessionId: "a12aa1:UAL1783:1791990000000",
    callsign: "UAL1783",
    flightNumber: "UA1783",
    tailNumber: "N17414",
    aircraftType: "B738",
    latitude: 42.4,
    longitude: -71.4,
    altitudeFeet: 10475,
    speedKnots: 271,
    headingDegrees: 141,
    origin: "ORD",
    destination: "BOS",
    onGround: false,
    firstObservedAt: "2026-10-14T15:00:00.000Z",
    departureTime: "2026-10-14T15:05:00.000Z",
    departureTimeSource: "observed",
    eta: "2026-10-14T16:10:00.000Z",
    etaSource: "calculated",
    progressPercent: 42,
    remainingDistanceNm: 123.4,
    emergency: null,
    observedAt: "2026-10-14T15:29:58.000Z",
    route: {
      waypoints: [
        {
          code: "ORD",
          iata: "ORD",
          icao: "KORD",
          name: "Chicago O'Hare International Airport",
          latitude: 41.9742,
          longitude: -87.9073,
        },
        {
          code: "BOS",
          iata: "BOS",
          icao: "KBOS",
          name: "Logan International Airport",
          latitude: 42.3656,
          longitude: -71.0096,
        },
      ],
    },
  }], capturedAt);

  const history = store.getHistory(
    "A12AA1",
    capturedAt - 1000,
    capturedAt + 1000,
  );
  assert.equal(history.length, 1);
  assert.equal(history[0].callsign, "UAL1783");
  assert.equal(history[0].flightSessionId, "a12aa1:UAL1783:1791990000000");
  assert.equal(history[0].flightNumber, "UA1783");
  assert.equal(history[0].aircraftType, "B738");
  assert.equal(history[0].capturedAt, "2026-10-14T15:30:00.000Z");
  assert.equal(history[0].onGround, false);
  assert.equal(history[0].firstObservedAt, "2026-10-14T15:00:00.000Z");
  assert.equal(history[0].departureTime, "2026-10-14T15:05:00.000Z");
  assert.equal(history[0].departureTimeSource, "observed");
  assert.equal(history[0].eta, "2026-10-14T16:10:00.000Z");
  assert.equal(history[0].etaSource, "calculated");
  assert.equal(history[0].progressPercent, 42);
  assert.equal(history[0].remainingDistanceNm, 123.4);

  assert.deepEqual(store.getReplayDates(), ["2026-10-14"]);
  assert.deepEqual(
    store.getAirportsForWindow(capturedAt - 1000, capturedAt + 1000).map((airport) => airport.code),
    ["BOS", "ORD"],
  );

  const route = { callsign: "UAL1783", origin: "ORD", destination: "BOS" };
  store.setRouteCache("ual1783", route, capturedAt + 60_000, capturedAt);
  assert.deepEqual(store.getRouteCache("UAL1783", capturedAt), {
    route,
    expiresAt: capturedAt + 60_000,
  });
  assert.equal(store.getRouteCache("UAL1783", capturedAt + 60_001), null);

  assert.equal(store.getProviderUsage("airlabs", "2026-10-14"), 0);
  assert.equal(store.countProviderRequest("airlabs", "2026-10-14"), 1);
  assert.equal(store.countProviderRequest("airlabs", "2026-10-14"), 2);
  store.close();
});

test("migrates an existing position database without deleting history", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "flight-tracker-migration-"));
  const filename = path.join(directory, "history.db");
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const legacy = new Database(filename);
  legacy.exec(`
    CREATE TABLE positions (
      aircraft_id TEXT NOT NULL,
      captured_at INTEGER NOT NULL,
      observed_at INTEGER NOT NULL,
      callsign TEXT,
      tail_number TEXT,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      altitude_feet REAL,
      speed_knots REAL,
      heading_degrees REAL,
      origin TEXT,
      destination TEXT,
      emergency_active INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (aircraft_id, captured_at)
    );
    INSERT INTO positions (
      aircraft_id, captured_at, observed_at, latitude, longitude
    ) VALUES ('a12aa1', 1, 1, 42.4, -71.4);
  `);
  legacy.close();

  const store = new HistoryStore(filename);
  const columns = store.database.prepare("PRAGMA table_info(positions)").all()
    .map((column) => column.name);
  assert.ok(columns.includes("departure_time_source"));
  assert.ok(columns.includes("remaining_distance_nm"));
  assert.ok(columns.includes("flight_session_id"));
  assert.ok(columns.includes("flight_number"));
  assert.ok(columns.includes("aircraft_type"));
  assert.equal(store.database.prepare("SELECT COUNT(*) AS total FROM positions").get().total, 1);
  store.close();
});

test("downsamples replay to one complete snapshot per time bucket", () => {
  const store = new HistoryStore(":memory:");
  const base = Date.parse("2026-10-14T00:00:00.000Z");
  const aircraft = (longitude) => ({
    id: "a12aa1",
    flightSessionId: "a12aa1:UAL1783:1",
    callsign: "UAL1783",
    flightNumber: "UA1783",
    tailNumber: "N17414",
    aircraftType: "B738",
    latitude: 42.4,
    longitude,
    altitudeFeet: 10_000,
    speedKnots: 250,
    headingDegrees: 90,
    origin: null,
    destination: null,
    onGround: false,
    firstObservedAt: "2026-10-14T00:00:00.000Z",
    departureTime: "2026-10-14T00:00:00.000Z",
    departureTimeSource: "first-observed",
    eta: null,
    etaSource: null,
    progressPercent: null,
    remainingDistanceNm: null,
    emergency: null,
    observedAt: new Date(base).toISOString(),
  });

  store.recordSnapshot([aircraft(-71.3)], base + 10_000);
  store.recordSnapshot([aircraft(-71.2)], base + 40_000);
  store.recordSnapshot([aircraft(-71.1)], base + 15 * 60_000 + 5_000);

  const points = store.getBucketedReplay(base, base + 30 * 60_000, 15 * 60);
  assert.equal(points.length, 2);
  assert.equal(points[0].longitude, -71.2);
  assert.equal(points[1].longitude, -71.1);
  store.close();
});
