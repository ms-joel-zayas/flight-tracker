import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HistoryStore } from "../backend/database.js";
import { seedDay, seedReplay, seedSnapshotsFromDataJson } from "../backend/seed.js";

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(fs.readFileSync(path.join(projectDirectory, "data.json"), "utf8"));
const NOW = Date.parse("2026-11-12T15:00:00.000Z");

function tempStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "seed-test-"));
  return new HistoryStore(path.join(directory, "test.db"));
}

test("the seed day is yesterday in UTC", () => {
  assert.equal(seedDay(NOW), "2026-11-11");
});

test("data.json becomes one snapshot per period, in the backend aircraft shape", () => {
  const snapshots = seedSnapshotsFromDataJson(data, "2026-11-11");
  assert.equal(snapshots.length, data.periods.length);
  assert.equal(snapshots[0].capturedAtMs, Date.parse("2026-11-11T12:00:00.000Z"));
  assert.equal(snapshots[1].capturedAtMs - snapshots[0].capturedAtMs, 15 * 60 * 1000);
  const ac2210 = snapshots[0].aircraft.find((item) => item.id === "ac2210");
  assert.equal(ac2210.flightNumber, "AC 2210");
  assert.equal(ac2210.latitude, data.periods[0].positions.AC2210.lat);
  assert.equal(ac2210.origin, "BOS");
  assert.deepEqual(ac2210.route.waypoints.map((point) => point.code), ["BOS", "ORD"]);
  assert.equal(ac2210.flightSessionId, "seed:AC2210");
});

test("a null altitude stays null (AC 1187), not 0", () => {
  const snapshots = seedSnapshotsFromDataJson(data, "2026-11-11");
  assert.equal(snapshots[0].aircraft.find((item) => item.id === "ac1187").altitudeFeet, null);
});

test("seeding fills replay, and re-seeding replaces the seed without touching live data", (context) => {
  const store = tempStore();
  context.after(() => store.close());
  const live = { id: "abc123", flightSessionId: "abc123:TEST:1", callsign: "TEST", observedAt: new Date(NOW).toISOString(), latitude: 42, longitude: -71, emergency: null };
  store.recordSnapshot([live], NOW);

  const first = seedReplay(store, { nowMs: NOW });
  assert.deepEqual([first.day, first.frames, first.aircraft], ["2026-11-11", 5, 8]);
  assert.ok(store.getReplayDates().includes("2026-11-11"));

  seedReplay(store, { nowMs: NOW + 24 * 60 * 60 * 1000 });
  const dates = store.getReplayDates();
  assert.ok(dates.includes("2026-11-12"), "the new seed day is there");
  assert.ok(!dates.includes("2026-11-11"), "the old seed day was replaced");
  assert.equal(store.getHistory("abc123", NOW - 1, NOW + 1).length, 1, "recorded live data is untouched");
});

test("seeded replay comes back from the replay query with its airports", (context) => {
  const store = tempStore();
  context.after(() => store.close());
  seedReplay(store, { nowMs: NOW });
  const from = Date.parse("2026-11-11T00:00:00.000Z");
  const points = store.getBucketedReplay(from, from + 24 * 60 * 60 * 1000 - 1, 900);
  assert.equal(points.length, 40);
  assert.deepEqual(store.getAirportsForWindow(from, from + 24 * 60 * 60 * 1000).map((a) => a.code).sort(), ["ATL", "BOS", "DEN", "JFK", "LAX", "ORD", "SEA", "SFO"]);
});
