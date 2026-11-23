import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../backend/app.js";

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("serves the Chart.js browser build used by the Week 12 chart", async (context) => {
  const config = {
    projectDirectory, historyRetentionHours: 168, replayMaxRangeHours: 24, replayStepSeconds: 900,
    positionProvider: "adsbfi", adsbFi: { baseUrl: "https://example.test/api" }, corsOrigins: new Set(),
  };
  const historyStore = { getReplay: () => [], getReplayDates: () => [], getHistory: () => [], getAirportsForWindow: () => [] };
  const collector = { getSnapshot: () => ({ meta: {}, aircraft: [] }), getAircraft: () => null };
  const app = createApp({ config, collector, historyStore, aircraftEnricher: { enrich: async (x) => x } });
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/vendor/chartjs/chart.umd.min.js`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Chart\.js v4\.5\.1/);
});
