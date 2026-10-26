import { AirLabsEnricher } from "./airlabs-enricher.js";
import { createApp } from "./app.js";
import { FlightCollector } from "./collector.js";
import { loadConfig } from "./config.js";
import { HistoryStore } from "./database.js";
import { AdsbDbProvider } from "./providers/adsbdb.js";
import { AdsbLolProvider } from "./providers/adsblol.js";
import { AirLabsProvider } from "./providers/airlabs.js";

const config = loadConfig();
const historyStore = new HistoryStore(config.sqlitePath);
const adsbDbProvider = new AdsbDbProvider(config.adsbDb);
const adsbProvider = new AdsbLolProvider({
  ...config.adsbLol,
  routeFallback: adsbDbProvider,
});
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
const app = createApp({ config, collector, historyStore, airLabsEnricher });

await collector.start();

const server = app.listen(config.port, () => {
  console.log(`Flight Tracker running at http://localhost:${config.port}`);
  console.log(
    `Tracking ${config.tracking.radiusNm} nm around ${config.tracking.latitude}, ${config.tracking.longitude}`,
  );
  console.log(`AirLabs enrichment: ${airLabsEnricher.enabled ? "enabled" : "disabled"}`);
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
