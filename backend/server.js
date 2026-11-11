import { AirLabsEnricher } from "./airlabs-enricher.js";
import { AircraftEnricher } from "./aircraft-enricher.js";
import { createApp } from "./app.js";
import { FlightCollector } from "./collector.js";
import { loadConfig } from "./config.js";
import { HistoryStore } from "./database.js";
import { AdsbDbProvider } from "./providers/adsbdb.js";
import { AdsbFiProvider } from "./providers/adsbfi.js";
import { AdsbLolProvider } from "./providers/adsblol.js";
import { AirLabsProvider } from "./providers/airlabs.js";
import { PositionProvider } from "./providers/positions.js";
import { DemoFailureProvider } from "./providers/demo.js";
import { seedReplay } from "./seed.js";

const config = loadConfig();
const historyStore = new HistoryStore(config.sqlitePath);
const adsbDbProvider = new AdsbDbProvider(config.adsbDb);
const adsbFiProvider = new AdsbFiProvider(config.adsbFi);
const adsbLolProvider = new AdsbLolProvider({
  ...config.adsbLol,
  routeFallback: adsbDbProvider,
});
const positionProviders = config.positionProvider === "adsblol"
  ? [adsbLolProvider, adsbFiProvider]
  : [adsbFiProvider, adsbLolProvider];
const routeProvider = config.positionProvider === "adsblol"
  ? adsbLolProvider
  : adsbDbProvider;
const realPositionProvider = new PositionProvider({
  providers: positionProviders,
  routeProvider,
});
// DEMO_FAILURE (mentor-only) wraps the real providers so a failure can be shown on purpose.
const adsbProvider = ["down", "stale", "empty"].includes(config.demoFailure)
  ? new DemoFailureProvider(realPositionProvider, config.demoFailure)
  : realPositionProvider;

// A fresh database has nothing to replay yet: load data.json so REPLAY works offline from the first run.
if (config.seedReplayIfEmpty && historyStore.getReplayDates().length === 0) {
  const seeded = seedReplay(historyStore);
  console.log(`Replay was empty: seeded ${seeded.day} (UTC) from data.json (${seeded.frames} frames). Re-run with npm run seed.`);
}
const airLabsProvider = new AirLabsProvider(config.airLabs);
const collector = new FlightCollector({
  config,
  adsbProvider,
  historyStore,
});
const airLabsEnricher = new AirLabsEnricher({
  provider: airLabsProvider,
  store: historyStore,
  cacheMs: config.airLabs.cacheMs,
  dailyRequestLimit: config.airLabs.dailyRequestLimit,
});
const aircraftEnricher = new AircraftEnricher({
  adsbDbProvider,
  airLabsEnricher,
});
const app = createApp({ config, collector, historyStore, aircraftEnricher });

await collector.start();

const server = app.listen(config.port, () => {
  console.log(`Flight Tracker running at http://localhost:${config.port}`);
  console.log(
    `Tracking ${config.tracking.radiusNm} nm around ${config.tracking.latitude}, ${config.tracking.longitude}`,
  );
  console.log(`Position providers: ${positionProviders.map((provider) => provider.name).join(" -> ")}`);
  console.log("Selected-aircraft details: ADSBDB enabled (cached, no key required)");
  console.log(`AirLabs enrichment: ${airLabsEnricher.enabled ? "enabled" : "disabled"}`);
  if (config.demoFailure) {
    console.warn(`DEMO_FAILURE=${config.demoFailure} is ON: the live feed is failing on purpose. Remove it from .env for normal use.`);
  }
});

function shutdown(signal) {
  console.log(`\n${signal} received; shutting down`);
  collector.stop();
  server.close(() => {
    historyStore.close();
    process.exit(0);
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
