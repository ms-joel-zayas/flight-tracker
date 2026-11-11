import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../backend/config.js";

test("defaults to seven-day retention and one-day replay queries", () => {
  const config = loadConfig({});
  assert.equal(config.historyRetentionHours, 168);
  assert.equal(config.replayMaxRangeHours, 24);
  assert.equal(config.replayStepSeconds, 900);
  assert.equal(config.pollIntervalMs, 30_000);
});

test("rejects a replay window longer than retained history", () => {
  assert.throws(
    () => loadConfig({ HISTORY_RETENTION_HOURS: "12", REPLAY_MAX_RANGE_HOURS: "24" }),
    /cannot exceed HISTORY_RETENTION_HOURS/,
  );
});
