import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../backend/app.js";
import { toCsv } from "../backend/export.js";
import { parseCsv } from "../js/analysis.js";

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

const recorded = {
  id: "a12aa1", flightSessionId: "a12aa1:1", capturedAt: "2026-11-18T01:00:00.000Z",
  callsign: "UAL1783", latitude: 42.1, longitude: -71.6, altitudeFeet: 34000, speedKnots: 450,
  onGround: false, origin: "BOS", destination: "ORD, IL", emergencyActive: false,
};
const seeded = { ...recorded, id: "seed1", flightSessionId: "seed:seed1:0" };

async function startServer(context, points) {
  const calls = [];
  const historyStore = {
    getReplay: (fromMs, toMs, limit) => { calls.push({ fromMs, toMs, limit }); return points.map((p) => ({ ...p })); },
    getReplayDates: () => [], getHistory: () => [], getAirportsForWindow: () => [],
  };
  const config = {
    projectDirectory, historyRetentionHours: 168, replayMaxRangeHours: 24, replayStepSeconds: 900,
    positionProvider: "adsbfi", adsbFi: { baseUrl: "https://example.test/api" }, corsOrigins: new Set(),
  };
  const collector = { getSnapshot: () => ({ meta: {}, aircraft: [] }), getAircraft: () => null };
  const server = await listen(createApp({ config, collector, historyStore, aircraftEnricher: { enrich: async (x) => x } }));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  return { base: `http://127.0.0.1:${server.address().port}`, calls };
}

test("exports one UTC day as CSV without seeded placeholder rows", async (context) => {
  const { base, calls } = await startServer(context, [recorded, seeded]);
  const response = await fetch(`${base}/api/export?date=2026-11-18`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/csv/);
  assert.match(response.headers.get("content-disposition"), /flight-data-2026-11-18\.csv/);
  assert.equal(response.headers.get("x-export-rows"), "1");
  assert.equal(calls[0].fromMs, Date.parse("2026-11-18T00:00:00.000Z"));
  const rows = parseCsv(await response.text());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].aircraft_id, "a12aa1");
  assert.equal(rows[0].destination, "ORD, IL");
  assert.equal(rows[0].altitude_feet, 34000);
  assert.equal(rows[0].on_ground, 0);
  assert.equal(rows[0].tail_number, null);
});

test("exports JSON and rejects bad dates or formats", async (context) => {
  const { base } = await startServer(context, [recorded]);
  const json = await (await fetch(`${base}/api/export?date=2026-11-18&format=json`)).json();
  assert.equal(json.rows[0].callsign, "UAL1783");
  assert.equal(json.truncated, false);
  assert.equal((await fetch(`${base}/api/export?date=yesterday`)).status, 400);
  assert.equal((await fetch(`${base}/api/export?date=2026-02-31`)).status, 400);
  assert.equal((await fetch(`${base}/api/export?date=2026-11-18&format=xlsx`)).status, 400);
});

test("CSV quotes cells with commas and quotes", () => {
  const csv = toCsv([{ ...recorded, callsign: 'A"B' }]);
  assert.match(csv, /"A""B"/);
  assert.equal(parseCsv(csv)[0].callsign, 'A"B');
});
