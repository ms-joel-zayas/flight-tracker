import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../backend/config.js";

test("defaults to seven-day retention and one-day replay queries", () => {
  const config = loadConfig({});
  assert.equal(config.historyRetentionHours, 168);
  assert.equal(config.replayMaxRangeHours, 24);
  assert.equal(config.replayStepSeconds, 900);
  assert.equal(config.pollIntervalMs, 30_000);
  assert.equal(config.positionProvider, "adsbfi");
  assert.equal(config.adsbFi.baseUrl, "https://opendata.adsb.fi/api");
});

test("rejects a replay window longer than retained history", () => {
  assert.throws(
    () => loadConfig({ HISTORY_RETENTION_HOURS: "12", REPLAY_MAX_RANGE_HOURS: "24" }),
    /cannot exceed HISTORY_RETENTION_HOURS/,
  );
});

test("rejects an unknown position provider", () => {
  assert.throws(
    () => loadConfig({ ADSB_POSITION_PROVIDER: "unknown" }),
    /ADSB_POSITION_PROVIDER must be one of: adsbfi, adsblol/,
  );
});
