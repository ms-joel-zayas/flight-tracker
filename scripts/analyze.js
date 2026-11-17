/*
 * Week 11 answer key: print the reference analysis for a CSV export.
 *   npm run analyze -- data/recorded-day.csv
 * Cross-check: compute the same numbers in a spreadsheet and compare.
 */
import fs from "node:fs";
import { parseCsv, summarize } from "../js/analysis.js";

const file = process.argv[2] || "data/recorded-day.csv";
const rows = parseCsv(fs.readFileSync(file, "utf8"));
const result = summarize(rows);
const pct = (share) => (share === null ? "n/a" : `${(share * 100).toFixed(1)}%`);
const num = (value, digits = 0) => (value === null ? "n/a" : value.toLocaleString("en-US", { maximumFractionDigits: digits }));

console.log(`Analysis of ${file}`);
console.log(`Time span (UTC): ${result.from} to ${result.to}`);
console.log(`Rows: ${num(result.rows)}  Snapshots: ${num(result.snapshots)}  Distinct aircraft: ${num(result.aircraft)}`);
console.log(`Altitude (airborne rows): min ${num(result.altitudeFeet.min)} ft, max ${num(result.altitudeFeet.max)} ft, average ${num(result.altitudeFeet.average)} ft, median ${num(result.altitudeFeet.median)} ft`);
console.log(`Speed (airborne rows): min ${num(result.speedKnots.min)} kt, max ${num(result.speedKnots.max)} kt, average ${num(result.speedKnots.average)} kt`);
console.log(`Missing: callsign ${pct(result.missing.callsign)}, altitude ${pct(result.missing.altitude_feet)}, route ${pct(result.missing.origin)}, aircraft type ${pct(result.missing.aircraft_type)}`);
console.log(`Aircraft with a known route: ${result.aircraftWithRoute} of ${result.aircraft}`);
console.log(`Median minutes each aircraft was seen: ${num(result.medianMinutesSeen, 1)}  Median seconds between updates: ${num(result.medianUpdateGapSeconds, 1)}`);
console.log(`Farthest from Uxbridge: ${num(result.distanceFromReferenceNm.max, 1)} nm  Emergency rows: ${result.emergencyRows}`);
console.log("Distinct aircraft per UTC hour:");
for (const hour of result.perHour) console.log(`  ${hour.hour}  ${String(hour.aircraft).padStart(4)} aircraft  (${hour.rows} rows)`);
