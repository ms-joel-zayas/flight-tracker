import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../backend/app.js";

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("serves the normalized aircraft snapshot", async (context) => {
  const aircraft = { id: "a12aa1", callsign: "UAL1783" };
  const collector = {
    getSnapshot: () => ({
      meta: { status: "live", updatedAt: "2026-10-14T15:30:00.000Z" },
      aircraft: [aircraft],
    }),
    getAircraft: (id) => id.toLowerCase() === aircraft.id ? aircraft : null,
  };
  const position = {
    id: aircraft.id,
    capturedAt: "2026-10-14T15:30:00.000Z",
    latitude: 42.4,
    longitude: -71.4,
  };
  const historyStore = {
    getHistory: () => [position],
    getReplay: () => [position],
  };
  const airLabsEnricher = {
    enabled: false,
    enrich: async (item) => ({ ...item, enrichment: { airLabs: "disabled" } }),
  };
  const config = {
    projectDirectory,
    historyRetentionHours: 24,
    corsOrigins: new Set(),
  };
  const server = await listen(createApp({ config, collector, historyStore, airLabsEnricher }));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();

  const response = await fetch(`http://127.0.0.1:${address.port}/api/aircraft`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.aircraft[0].callsign, "UAL1783");

  const detailResponse = await fetch(`http://127.0.0.1:${address.port}/api/aircraft/a12aa1`);
  assert.equal(detailResponse.status, 200);
  const detail = await detailResponse.json();
  assert.equal(detail.aircraft.enrichment.airLabs, "disabled");

  const query = "from=2026-10-14T15%3A00%3A00.000Z&to=2026-10-14T16%3A00%3A00.000Z";
  const historyResponse = await fetch(
    `http://127.0.0.1:${address.port}/api/aircraft/a12aa1/history?${query}`,
  );
  assert.equal(historyResponse.status, 200);
  const history = await historyResponse.json();
  assert.equal(history.points[0].id, aircraft.id);

  const replayResponse = await fetch(`http://127.0.0.1:${address.port}/api/replay?${query}`);
  assert.equal(replayResponse.status, 200);
  const replay = await replayResponse.json();
  assert.equal(replay.frames[0].aircraft[0].id, aircraft.id);

  const healthResponse = await fetch(`http://127.0.0.1:${address.port}/api/health`);
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  assert.equal(health.providers.adsbDb.enabled, true);
  assert.equal(health.providers.airLabs.enabled, false);

  const frontendModule = await fetch(`http://127.0.0.1:${address.port}/js/api.js`);
  assert.equal(frontendModule.status, 200);
});

test("rejects an invalid replay time window", async (context) => {
  const app = createApp({
    config: { projectDirectory, historyRetentionHours: 24, corsOrigins: new Set() },
    collector: { getSnapshot: () => ({ meta: { status: "live" }, aircraft: [] }) },
    historyStore: { getHistory: () => [], getReplay: () => [] },
    airLabsEnricher: { enabled: false },
  });
  const server = await listen(app);
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/replay?from=2026-10-15&to=2026-10-14`,
  );
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /earlier than/);
});
