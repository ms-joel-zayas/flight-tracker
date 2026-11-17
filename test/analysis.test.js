import test from "node:test";
import assert from "node:assert/strict";
import {
  aircraftPerHour, average, climbRates, count, distanceNm, distinctCount, histogram, maximum, median,
  minimum, missingRate, numbers, parseCsv, perAircraft, sortBy, summarize, updateGaps,
} from "../js/analysis.js";

// Two aircraft, snapshots every 30 s: 5 rows but only 2 aircraft.
const rows = [
  { aircraft_id: "a", captured_at: "2026-11-18T00:59:30.000Z", callsign: "JBU1", altitude_feet: 10000, speed_knots: 300, origin: "BOS", destination: "JFK", on_ground: 0 },
  { aircraft_id: "a", captured_at: "2026-11-18T01:00:00.000Z", callsign: "JBU1", altitude_feet: 11000, speed_knots: 310, origin: "BOS", destination: "JFK", on_ground: 0 },
  { aircraft_id: "a", captured_at: "2026-11-18T01:00:30.000Z", callsign: "JBU1", altitude_feet: 12000, speed_knots: 320, origin: "BOS", destination: "JFK", on_ground: 0 },
  { aircraft_id: "b", captured_at: "2026-11-18T01:00:00.000Z", callsign: null, altitude_feet: null, speed_knots: 120, origin: null, destination: null, on_ground: 0 },
  { aircraft_id: "b", captured_at: "2026-11-18T01:01:30.000Z", callsign: null, altitude_feet: 3000, speed_knots: 130, origin: null, destination: null, on_ground: 0 },
];

test("rows are not aircraft", () => {
  assert.equal(count(rows), 5);
  assert.equal(distinctCount(rows), 2);
});

test("min, max, average and median ignore missing values", () => {
  const altitudes = numbers(rows, "altitude_feet");
  assert.deepEqual(altitudes, [10000, 11000, 12000, 3000]);
  assert.equal(minimum(altitudes), 3000);
  assert.equal(maximum(altitudes), 12000);
  assert.equal(average(altitudes), 9000);
  assert.equal(median(altitudes), 10500);
  assert.equal(average([]), null);
});

test("missing-data rate is the share of rows without a value", () => {
  assert.equal(missingRate(rows, "callsign"), 0.4);
  assert.equal(missingRate(rows, "altitude_feet"), 0.2);
  assert.equal(missingRate([], "callsign"), null);
});

test("change over time counts distinct aircraft per UTC hour", () => {
  assert.deepEqual(aircraftPerHour(rows), [
    { hour: "00:00", aircraft: 1, rows: 1 },
    { hour: "01:00", aircraft: 2, rows: 4 },
  ]);
});

test("per-aircraft summary, sorting and update gaps", () => {
  const summary = perAircraft(rows);
  const a = summary.find((item) => item.aircraft_id === "a");
  assert.equal(a.minutesSeen, 1);
  assert.equal(a.routeKnown, true);
  assert.equal(sortBy(summary, "maxAltitudeFeet")[0].aircraft_id, "a");
  assert.deepEqual(updateGaps(rows).sort((x, y) => x - y), [30, 30, 90]);
});

test("challenge measures: distance, climb rate and bands", () => {
  const oneDegreeLat = distanceNm({ latitude: 42, longitude: -71 }, { latitude: 43, longitude: -71 });
  assert.ok(Math.abs(oneDegreeLat - 60) < 0.1);
  assert.deepEqual(climbRates(rows).sort((x, y) => x - y), [2000, 2000]);
  assert.deepEqual(histogram([1000, 4000, 12000], 5000), [
    { from: 0, to: 5000, count: 2 }, { from: 10000, to: 15000, count: 1 },
  ]);
});

test("parseCsv reads the export format and summarize agrees with the parts", () => {
  const parsed = parseCsv('captured_at,aircraft_id,callsign,altitude_feet\n2026-11-18T01:00:00.000Z,abc123,"A,B",35000\n2026-11-18T01:00:30.000Z,abc123,,\n');
  assert.deepEqual(parsed[0], { captured_at: "2026-11-18T01:00:00.000Z", aircraft_id: "abc123", callsign: "A,B", altitude_feet: 35000 });
  assert.equal(parsed[1].callsign, null);
  const result = summarize(rows);
  assert.equal(result.aircraft, 2);
  assert.equal(result.rows, 5);
  assert.equal(result.aircraftWithRoute, 1);
  assert.equal(result.medianUpdateGapSeconds, 30);
});
