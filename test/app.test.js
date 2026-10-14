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
  const historyStore = {
    getHistory: () => [],
    getReplay: () => [],
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
});

