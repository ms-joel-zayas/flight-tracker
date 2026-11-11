import path from "node:path";
import express from "express";

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const MAX_REPLAY_ROWS = 50_000;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseTimestamp(value, fallback) {
  if (value === undefined) return fallback;
  if (/^\d+$/.test(String(value))) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function requestedWindow(
  request,
  config,
  defaultDurationMs = ONE_HOUR_MS,
  maximumDurationMs = config.historyRetentionHours * ONE_HOUR_MS,
) {
  const now = Date.now();
  const toMs = parseTimestamp(request.query.to, now);
  const fromMs = parseTimestamp(request.query.from, toMs - defaultDurationMs);

  if (fromMs === null || toMs === null) {
    return { error: "from and to must be ISO dates or millisecond timestamps" };
  }
  if (fromMs >= toMs) {
    return { error: "from must be earlier than to" };
  }
  if (toMs - fromMs > maximumDurationMs) {
    return { error: `The requested range cannot exceed ${maximumDurationMs / ONE_HOUR_MS} hours` };
  }
  return { fromMs, toMs };
}

function replayRequest(request, config) {
  const requestedDate = request.query.date;
  const rawInterval = request.query.intervalSeconds;
  const intervalSeconds = rawInterval === undefined
    ? requestedDate ? config.replayStepSeconds : null
    : Number(rawInterval);

  if (intervalSeconds !== null
    && (!Number.isFinite(intervalSeconds) || intervalSeconds < 30 || intervalSeconds > 3600)) {
    return { error: "intervalSeconds must be a number from 30 to 3600" };
  }

  if (requestedDate !== undefined) {
    if (!ISO_DATE_PATTERN.test(requestedDate)) {
      return { error: "date must use YYYY-MM-DD" };
    }
    const fromMs = Date.parse(`${requestedDate}T00:00:00.000Z`);
    if (!Number.isFinite(fromMs) || new Date(fromMs).toISOString().slice(0, 10) !== requestedDate) {
      return { error: "date must be a real calendar date" };
    }
    return {
      date: requestedDate,
      fromMs,
      toMs: fromMs + ONE_DAY_MS - 1,
      intervalSeconds,
    };
  }

  const maximumRangeHours = config.replayMaxRangeHours
    || Math.min(config.historyRetentionHours, 24);
  const window = requestedWindow(
    request,
    config,
    ONE_HOUR_MS,
    maximumRangeHours * ONE_HOUR_MS,
  );
  return window.error ? window : { ...window, date: null, intervalSeconds };
}

function groupReplayFrames(points) {
  const frames = [];
  let currentFrame = null;

  for (const point of points) {
    if (!currentFrame || currentFrame.timestamp !== point.capturedAt) {
      currentFrame = { timestamp: point.capturedAt, aircraft: [] };
      frames.push(currentFrame);
    }
    const { capturedAt, ...aircraftPoint } = point;
    currentFrame.aircraft.push(aircraftPoint);
  }
  return frames;
}

export function createApp({
  config,
  collector,
  historyStore,
  aircraftEnricher = {
    airLabsEnabled: false,
    enrich: async (aircraft) => aircraft,
  },
}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));

  app.use((request, response, next) => {
    const origin = request.get("Origin");
    if (origin && config.corsOrigins.has(origin)) {
      response.set("Access-Control-Allow-Origin", origin);
      response.set("Vary", "Origin");
      response.set("Access-Control-Allow-Methods", "GET, OPTIONS");
      response.set("Access-Control-Allow-Headers", "Content-Type");
    }
    if (request.method === "OPTIONS") return response.sendStatus(204);
    next();
  });

  app.get("/api/aircraft", (request, response) => {
    response.set("Cache-Control", "no-store");
    const snapshot = collector.getSnapshot();
    response.status(snapshot.meta.status === "starting" ? 503 : 200).json(snapshot);
  });

  app.get("/api/aircraft/:id", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const aircraft = collector.getAircraft(request.params.id);
    if (!aircraft) {
      return response.status(404).json({ error: "Aircraft is not in the current regional snapshot" });
    }

    const enrichedAircraft = await aircraftEnricher.enrich(aircraft);
    response.json({ aircraft: enrichedAircraft });
  });

  app.get("/api/aircraft/:id/history", (request, response) => {
    response.set("Cache-Control", "no-store");
    const window = requestedWindow(request, config);
    if (window.error) return response.status(400).json({ error: window.error });

    const points = historyStore.getHistory(
      request.params.id,
      window.fromMs,
      window.toMs,
    );
    response.json({
      aircraftId: request.params.id.toLowerCase(),
      from: new Date(window.fromMs).toISOString(),
      to: new Date(window.toMs).toISOString(),
      points,
    });
  });

  app.get("/api/replay/dates", (request, response) => {
    response.set("Cache-Control", "no-store");
    response.json({
      dates: historyStore.getReplayDates?.() || [],
      retentionHours: config.historyRetentionHours,
    });
  });

  app.get("/api/replay", (request, response) => {
    response.set("Cache-Control", "no-store");
    const window = replayRequest(request, config);
    if (window.error) return response.status(400).json({ error: window.error });

    const points = window.intervalSeconds && historyStore.getBucketedReplay
      ? historyStore.getBucketedReplay(
          window.fromMs,
          window.toMs,
          window.intervalSeconds,
          MAX_REPLAY_ROWS + 1,
        )
      : historyStore.getReplay(window.fromMs, window.toMs, MAX_REPLAY_ROWS + 1);
    const truncated = points.length > MAX_REPLAY_ROWS;
    if (truncated) points.pop();

    response.json({
      date: window.date,
      from: new Date(window.fromMs).toISOString(),
      to: new Date(window.toMs).toISOString(),
      intervalSeconds: window.intervalSeconds,
      truncated,
      availableDates: historyStore.getReplayDates?.() || [],
      airports: historyStore.getAirportsForWindow?.(window.fromMs, window.toMs) || [],
      frames: groupReplayFrames(points),
    });
  });

  app.get("/api/health", (request, response) => {
    response.set("Cache-Control", "no-store");
    const meta = collector.getSnapshot().meta;
    response.status(meta.status === "starting" ? 503 : 200).json({
      status: meta.status,
      updatedAt: meta.updatedAt,
      updateAgeSeconds: meta.updateAgeSeconds,
      warning: meta.warning,
      providers: {
        adsbFi: {
          enabled: Boolean(config.adsbFi),
          purpose: config.positionProvider === "adsbfi" ? "primary positions" : "position fallback",
        },
        adsbLol: {
          enabled: true,
          purpose: config.positionProvider === "adsblol"
            ? "primary positions and routes"
            : "position fallback",
        },
        adsbDb: {
          enabled: true,
          purpose: config.positionProvider === "adsblol"
            ? "route fallback and selected-aircraft details"
            : "routes and selected-aircraft details",
        },
        airLabs: { enabled: aircraftEnricher.airLabsEnabled },
      },
      historyRetentionHours: config.historyRetentionHours,
      replayMaxRangeHours: config.replayMaxRangeHours || Math.min(config.historyRetentionHours, 24),
      replayStepSeconds: config.replayStepSeconds || 15 * 60,
      availableReplayDates: historyStore.getReplayDates?.() || [],
    });
  });

  app.get("/", (request, response) => {
    response.sendFile(path.join(config.projectDirectory, "index.html"));
  });
  app.use("/css", express.static(path.join(config.projectDirectory, "css")));
  app.use("/js", express.static(path.join(config.projectDirectory, "js")));
  app.use(
    "/vendor/leaflet",
    express.static(path.join(config.projectDirectory, "node_modules", "leaflet", "dist")),
  );

  app.use("/api", (request, response) => {
    response.status(404).json({ error: "API endpoint not found" });
  });

  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    console.error(error);
    response.status(500).json({ error: "Unexpected server error" });
  });

  return app;
}
