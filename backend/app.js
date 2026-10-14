import path from "node:path";
import express from "express";

const ONE_HOUR_MS = 60 * 60 * 1000;
const MAX_REPLAY_ROWS = 50_000;

function parseTimestamp(value, fallback) {
  if (value === undefined) return fallback;
  if (/^\d+$/.test(String(value))) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function requestedWindow(request, config, defaultDurationMs = ONE_HOUR_MS) {
  const now = Date.now();
  const toMs = parseTimestamp(request.query.to, now);
  const fromMs = parseTimestamp(request.query.from, toMs - defaultDurationMs);
  const maximumRangeMs = config.historyRetentionHours * ONE_HOUR_MS;

  if (fromMs === null || toMs === null) {
    return { error: "from and to must be ISO dates or millisecond timestamps" };
  }
  if (fromMs >= toMs) {
    return { error: "from must be earlier than to" };
  }
  if (toMs - fromMs > maximumRangeMs) {
    return { error: `The requested range cannot exceed ${config.historyRetentionHours} hours` };
  }
  return { fromMs, toMs };
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

export function createApp({ config, collector, historyStore, airLabsEnricher }) {
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

    const enrichedAircraft = await airLabsEnricher.enrich(aircraft);
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

  app.get("/api/replay", (request, response) => {
    response.set("Cache-Control", "no-store");
    const window = requestedWindow(request, config);
    if (window.error) return response.status(400).json({ error: window.error });

    const points = historyStore.getReplay(
      window.fromMs,
      window.toMs,
      MAX_REPLAY_ROWS + 1,
    );
    const truncated = points.length > MAX_REPLAY_ROWS;
    if (truncated) points.pop();

    response.json({
      from: new Date(window.fromMs).toISOString(),
      to: new Date(window.toMs).toISOString(),
      truncated,
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
        adsbLol: { enabled: true },
        airLabs: { enabled: airLabsEnricher.enabled },
      },
      historyRetentionHours: config.historyRetentionHours,
    });
  });

  app.get("/", (request, response) => {
    response.sendFile(path.join(config.projectDirectory, "index.html"));
  });
  app.use("/css", express.static(path.join(config.projectDirectory, "css")));
  app.use("/js", express.static(path.join(config.projectDirectory, "js")));

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

