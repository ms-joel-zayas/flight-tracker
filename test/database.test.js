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
    callsign: "UAL1783",
    tailNumber: "N17414",
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
  }], capturedAt);

  const history = store.getHistory(
    "A12AA1",
    capturedAt - 1000,
    capturedAt + 1000,
  );
  assert.equal(history.length, 1);
  assert.equal(history[0].callsign, "UAL1783");
  assert.equal(history[0].capturedAt, "2026-10-14T15:30:00.000Z");
  assert.equal(history[0].onGround, false);
  assert.equal(history[0].firstObservedAt, "2026-10-14T15:00:00.000Z");
  assert.equal(history[0].departureTime, "2026-10-14T15:05:00.000Z");
  assert.equal(history[0].departureTimeSource, "observed");
  assert.equal(history[0].eta, "2026-10-14T16:10:00.000Z");
  assert.equal(history[0].etaSource, "calculated");
  assert.equal(history[0].progressPercent, 42);
  assert.equal(history[0].remainingDistanceNm, 123.4);

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
  assert.equal(store.database.prepare("SELECT COUNT(*) AS total FROM positions").get().total, 1);
  store.close();
});
