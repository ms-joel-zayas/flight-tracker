import test from "node:test";
import assert from "node:assert/strict";
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

  assert.equal(store.getProviderUsage("airlabs", "2026-10-14"), 0);
  assert.equal(store.countProviderRequest("airlabs", "2026-10-14"), 1);
  assert.equal(store.countProviderRequest("airlabs", "2026-10-14"), 2);
  store.close();
});

