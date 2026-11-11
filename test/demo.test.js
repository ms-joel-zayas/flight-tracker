import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../backend/config.js";
import { DemoFailureProvider } from "../backend/providers/demo.js";
import { createApp } from "../backend/app.js";

const realProvider = {
  name: "adsb.fi",
  fetchAircraft: async () => ({ ac: [{ hex: "abc123" }], now: 1 }),
  fetchRoutes: async () => new Map(),
};

test("DEMO_FAILURE is off by default and accepts only known modes", () => {
  assert.equal(loadConfig({}).demoFailure, "");
  assert.equal(loadConfig({ DEMO_FAILURE: "down" }).demoFailure, "down");
  assert.equal(loadConfig({ DEMO_FAILURE: " Empty " }).demoFailure, "empty");
  assert.throws(() => loadConfig({ DEMO_FAILURE: "explode" }), /DEMO_FAILURE must be one of/);
});

test("down: the provider fails on purpose", async () => {
  await assert.rejects(new DemoFailureProvider(realProvider, "down").fetchAircraft({}), /DEMO_FAILURE=down/);
});

test("stale: the first update works, later ones fail", async () => {
  const provider = new DemoFailureProvider(realProvider, "stale");
  assert.equal((await provider.fetchAircraft({})).ac.length, 1);
  await assert.rejects(provider.fetchAircraft({}), /DEMO_FAILURE=stale/);
});

test("empty: the provider answers with no aircraft", async () => {
  const payload = await new DemoFailureProvider(realProvider, "empty").fetchAircraft({});
  assert.deepEqual(payload.ac, []);
});

test("routes still come from the real provider", async () => {
  assert.ok((await new DemoFailureProvider(realProvider, "down").fetchRoutes([])) instanceof Map);
});

test("timeout: /api/aircraft answers only after the delay", async (context) => {
  const collector = { getSnapshot: () => ({ meta: { status: "live" }, aircraft: [] }), getAircraft: () => null };
  const config = { ...loadConfig({}), demoFailure: "timeout", demoTimeoutMs: 300 };
  const app = createApp({ config, collector, historyStore: {} });
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  context.after(() => server.close());
  const started = Date.now();
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/aircraft`);
  assert.equal(response.status, 200);
  assert.ok(Date.now() - started >= 290, "the answer was delayed");
});

test("SEED_REPLAY_IF_EMPTY defaults to on and can be turned off", () => {
  assert.equal(loadConfig({}).seedReplayIfEmpty, true);
  assert.equal(loadConfig({ SEED_REPLAY_IF_EMPTY: "false" }).seedReplayIfEmpty, false);
});
