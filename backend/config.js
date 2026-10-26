import path from "node:path";
import { fileURLToPath } from "node:url";

const backendDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(backendDirectory, "..");

function numberSetting(environment, name, fallback, { min, max } = {}) {
  const raw = environment[name];
  const value = raw === undefined || raw === "" ? fallback : Number(raw);

  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a number`);
  }
  if (min !== undefined && value < min) {
    throw new Error(`${name} must be at least ${min}`);
  }
  if (max !== undefined && value > max) {
    throw new Error(`${name} must be at most ${max}`);
  }
  return value;
}

function resolveFromProject(value) {
  return path.isAbsolute(value) ? value : path.resolve(projectDirectory, value);
}

export function loadConfig(environment = process.env) {
  const sqlitePath = environment.SQLITE_PATH || "backend/data/flight-tracker.db";

  return Object.freeze({
    projectDirectory,
    port: numberSetting(environment, "PORT", 3000, { min: 1, max: 65535 }),
    tracking: Object.freeze({
      latitude: numberSetting(environment, "TRACKING_LAT", 42.0773, { min: -90, max: 90 }),
      longitude: numberSetting(environment, "TRACKING_LON", -71.6295, { min: -180, max: 180 }),
      radiusNm: numberSetting(environment, "TRACKING_RADIUS_NM", 25, { min: 1, max: 250 }),
    }),
    pollIntervalMs: numberSetting(environment, "POLL_INTERVAL_MS", 30_000, { min: 5_000 }),
    staleAfterSeconds: numberSetting(environment, "STALE_AFTER_SECONDS", 60, { min: 1 }),
    historyRetentionHours: numberSetting(environment, "HISTORY_RETENTION_HOURS", 24, { min: 1, max: 168 }),
    sqlitePath: resolveFromProject(sqlitePath),
    adsbLol: Object.freeze({
      baseUrl: environment.ADSBLOL_BASE_URL || "https://api.adsb.lol",
      apiToken: environment.ADSBLOL_API_TOKEN || "",
      userAgent: environment.ADSBLOL_USER_AGENT
        || "uxbridge-flight-tracker/1.0 (+https://github.com/ms-joel-zayas/flight-tracker)",
      routeCacheMs: 6 * 60 * 60 * 1000,
    }),
    adsbDb: Object.freeze({
      baseUrl: environment.ADSBDB_BASE_URL || "https://api.adsbdb.com",
      userAgent: environment.ADSBDB_USER_AGENT
        || environment.ADSBLOL_USER_AGENT
        || "uxbridge-flight-tracker/1.0 (+https://github.com/ms-joel-zayas/flight-tracker)",
      maxConcurrency: numberSetting(environment, "ADSBDB_MAX_CONCURRENCY", 4, { min: 1, max: 10 }),
    }),
    airLabs: Object.freeze({
      baseUrl: environment.AIRLABS_BASE_URL || "https://airlabs.co/api/v9",
      apiKey: environment.AIRLABS_API_KEY || "",
      cacheMs: numberSetting(environment, "AIRLABS_CACHE_MINUTES", 15, { min: 1 }) * 60 * 1000,
      dailyRequestLimit: numberSetting(environment, "AIRLABS_DAILY_REQUEST_LIMIT", 30, { min: 0, max: 1000 }),
    }),
    corsOrigins: new Set(
      (environment.CORS_ORIGINS || "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  });
}
