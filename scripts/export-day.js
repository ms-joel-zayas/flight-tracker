/*
 * Mentor tool: write one recorded UTC day from SQLite to a CSV file.
 *   npm run export-day -- 2026-11-18 data/recorded-day.csv
 * (The running server offers the same data at /api/export?date=YYYY-MM-DD.)
 */
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../backend/config.js";
import { HistoryStore } from "../backend/database.js";
import { toCsv } from "../backend/export.js";

const [date, output = `data/flight-data-${date}.csv`] = process.argv.slice(2);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) {
  console.error("Usage: npm run export-day -- YYYY-MM-DD [output.csv]");
  process.exit(1);
}
const store = new HistoryStore(loadConfig().sqlitePath);
const fromMs = Date.parse(`${date}T00:00:00.000Z`);
const points = store.getReplay(fromMs, fromMs + 24 * 60 * 60 * 1000 - 1, 1_000_000)
  .filter((point) => !String(point.flightSessionId || "").startsWith("seed:"));
store.close();
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, toCsv(points));
console.log(`Wrote ${points.length} rows for ${date} (UTC) to ${output}`);
