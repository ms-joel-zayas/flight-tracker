/*
 * Week 12: turn one aircraft's recorded points into chart data and a plain-language summary.
 *
 * Pure functions only (no page, no Chart.js), so they can be tested with Jest:
 *   tests/chart-data.test.js
 *
 * js/app.js hands these results to Chart.js. The summary sentence is shown under the
 * chart and read by screen readers, so the chart never depends on seeing the line.
 */

export const CHART_FIELDS = Object.freeze({
  altitude: { key: "altitudeFeet", label: "Altitude", unit: "ft", steady: 300 },
  speed: { key: "speedKnots", label: "Speed", unit: "kt", steady: 20 },
});

/* The time of one point in milliseconds: when our backend saved it, or when the aircraft reported it */
export function pointTime(point) {
  const time = Date.parse(point?.capturedAt ?? point?.observedAt);
  return Number.isFinite(time) ? time : null;
}

/*
 * One series for the chart: [{ x: time in ms, y: value or null }] in time order.
 * A missing value stays in the series as null, so Chart.js leaves a gap instead of
 * drawing a line through data we do not have. Points after untilMs are left out
 * (in replay, the chart stops at the frame being shown).
 */
export function buildSeries(points, field = "altitude", { untilMs = Infinity } = {}) {
  const { key } = CHART_FIELDS[field];
  const timed = (points || [])
    .map((point) => ({ time: pointTime(point), point }))
    .filter(({ time }) => time !== null && time <= untilMs)
    .sort((a, b) => a.time - b.time);

  const data = [];
  for (const { time, point } of timed) {
    if (data.length && data.at(-1).x === time) continue; // the same snapshot twice
    const value = point[key];
    data.push({ x: time, y: Number.isFinite(value) ? value : null, onGround: point.onGround === true });
  }
  const values = data.filter((item) => item.y !== null);
  return {
    field,
    data,
    samples: values.length,
    missing: data.length - values.length,
    missingOnGround: data.filter((item) => item.y === null && item.onGround).length,
  };
}

function formatValue(value, unit) {
  return `${Math.round(value).toLocaleString("en-US")} ${unit}`;
}

function formatDuration(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

/* One sentence a person (or a screen reader) can use instead of looking at the line */
export function summarizeSeries(series) {
  const { label, unit, steady } = CHART_FIELDS[series.field];
  const values = series.data.filter((item) => item.y !== null);
  const missingNote = series.missing
    ? ` ${series.missing} sample${series.missing === 1 ? "" : "s"} had no ${label.toLowerCase()}${series.missingOnGround === series.missing ? " (on the ground)" : ""}.`
    : "";

  if (values.length < 2) {
    return `Not enough ${label.toLowerCase()} history yet (${values.length} sample${values.length === 1 ? "" : "s"}).${missingNote}`;
  }

  const first = values[0];
  const last = values.at(-1);
  const change = last.y - first.y;
  const duration = formatDuration(last.x - first.x);
  const numbers = values.map((item) => item.y);
  const low = Math.min(...numbers);
  const high = Math.max(...numbers);
  const words = series.field === "altitude"
    ? { up: "Climbed", down: "Descended", level: "Stayed level near" }
    : { up: "Sped up", down: "Slowed down", level: "Held steady near" };

  const trend = Math.abs(change) < steady
    ? `${words.level} ${formatValue((first.y + last.y) / 2, unit)} for ${duration}`
    : `${change > 0 ? words.up : words.down} from ${formatValue(first.y, unit)} to ${formatValue(last.y, unit)} in ${duration}`;
  return `${trend}. Range ${formatValue(low, unit)} to ${formatValue(high, unit)}, ${values.length} samples.${missingNote}`;
}
