/* Answer key (mentor reference) — Week 12, written for Jest
   Run from the project folder:   npm run test:frontend
   What is tested: the pure helpers in js/chart-data.js that turn one aircraft's points
   into chart data (in time order, gaps for missing values) and a one-sentence summary.
   The chart itself is checked by looking at it in the browser. */

import { buildSeries, pointTime, summarizeSeries } from "../js/chart-data.js";

const at = (minute, extra = {}) => ({
  capturedAt: new Date(Date.UTC(2026, 10, 17, 23, minute)).toISOString(),
  ...extra,
});

test("points without a usable time are left out", () => {
  expect(pointTime({ capturedAt: "not a date" })).toBeNull();
  expect(pointTime({ observedAt: "2026-11-17T23:00:00.000Z" })).toBe(Date.parse("2026-11-17T23:00:00.000Z"));
});

test("series is in time order and keeps one point per snapshot", () => {
  const series = buildSeries([
    at(2, { altitudeFeet: 5000 }),
    at(0, { altitudeFeet: 3000 }),
    at(1, { altitudeFeet: 4000 }),
    at(1, { altitudeFeet: 4000 }),
  ]);
  expect(series.data.map((item) => item.y)).toEqual([3000, 4000, 5000]);
  expect(series.samples).toBe(3);
});

test("a missing value stays as a gap (null), not a zero", () => {
  const series = buildSeries([
    at(0, { altitudeFeet: null, onGround: true }),
    at(1, { altitudeFeet: 1200 }),
    at(2, { altitudeFeet: 2500 }),
  ]);
  expect(series.data[0].y).toBeNull();
  expect(series.missing).toBe(1);
  expect(series.missingOnGround).toBe(1);
});

test("replay stops the series at the frame being shown", () => {
  const series = buildSeries(
    [at(0, { altitudeFeet: 1000 }), at(5, { altitudeFeet: 2000 }), at(10, { altitudeFeet: 3000 })],
    "altitude",
    { untilMs: Date.parse(at(5).capturedAt) },
  );
  expect(series.data).toHaveLength(2);
});

test("summary describes a climb with units and duration", () => {
  const series = buildSeries([at(0, { altitudeFeet: 3575 }), at(3, { altitudeFeet: 8000 }), at(6, { altitudeFeet: 12400 })]);
  expect(summarizeSeries(series)).toBe("Climbed from 3,575 ft to 12,400 ft in 6 min. Range 3,575 ft to 12,400 ft, 3 samples.");
});

test("summary says level flight and notes on-ground gaps", () => {
  const series = buildSeries([
    at(0, { altitudeFeet: null, onGround: true }),
    at(1, { altitudeFeet: 35000 }),
    at(2, { altitudeFeet: 35100 }),
  ]);
  expect(summarizeSeries(series)).toBe(
    "Stayed level near 35,050 ft for 1 min. Range 35,000 ft to 35,100 ft, 2 samples. 1 sample had no altitude (on the ground).",
  );
});

test("summary works for speed and for too little data", () => {
  const speed = buildSeries([at(0, { speedKnots: 250 }), at(4, { speedKnots: 180 })], "speed");
  expect(summarizeSeries(speed)).toBe("Slowed down from 250 kt to 180 kt in 4 min. Range 180 kt to 250 kt, 2 samples.");
  expect(summarizeSeries(buildSeries([at(0, { altitudeFeet: 9000 })]))).toBe("Not enough altitude history yet (1 sample).");
});
