import test from "node:test";
import assert from "node:assert/strict";
import { AircraftEnricher } from "../backend/aircraft-enricher.js";
import { AirLabsEnricher } from "../backend/airlabs-enricher.js";

test("merges ADSBDB identity before optional AirLabs enrichment", async () => {
  let airLabsInput = null;
  const enricher = new AircraftEnricher({
    adsbDbProvider: {
      fetchAircraftDetails: async () => ({
        tailNumber: "N201JQ",
        aircraftType: "E75L",
        aircraftModel: "Embraer 175LR",
        manufacturer: "Embraer",
        operator: "Republic Airways",
        registeredOwner: "Republic Airways Inc",
        route: {
          origin: "BOS",
          destination: "DCA",
          waypoints: [],
        },
        cache: "live",
      }),
    },
    airLabsEnricher: {
      enabled: false,
      enrich: async (aircraft) => {
        airLabsInput = aircraft;
        return {
          ...aircraft,
          enrichment: { ...aircraft.enrichment, airLabs: "disabled" },
        };
      },
    },
  });

  const result = await enricher.enrich({
    id: "a12aa1",
    callsign: "RPA5598",
    origin: null,
    destination: null,
  });

  assert.equal(airLabsInput.aircraftModel, "Embraer 175LR");
  assert.equal(result.tailNumber, "N201JQ");
  assert.equal(result.origin, "BOS");
  assert.equal(result.destination, "DCA");
  assert.equal(result.enrichment.adsbDb, "available");
  assert.equal(result.enrichment.airLabs, "disabled");
});

test("keeps selected-aircraft details available when ADSBDB fails", async () => {
  const enricher = new AircraftEnricher({
    adsbDbProvider: {
      fetchAircraftDetails: async () => { throw new Error("temporary outage"); },
    },
    airLabsEnricher: {
      enabled: false,
      enrich: async (aircraft) => aircraft,
    },
  });

  const result = await enricher.enrich({ id: "a12aa1", tailNumber: "N201JQ" });
  assert.equal(result.tailNumber, "N201JQ");
  assert.equal(result.enrichment.adsbDb, "error");
  assert.match(result.enrichment.adsbDbMessage, /temporary outage/);
});

test("disabled AirLabs keeps enrichment supplied by other providers", async () => {
  const airLabs = new AirLabsEnricher({
    provider: { enabled: false },
    store: {},
    cacheMs: 60_000,
    dailyRequestLimit: 0,
  });

  const result = await airLabs.enrich({
    id: "a12aa1",
    enrichment: { adsbDb: "available" },
  });
  assert.equal(result.enrichment.adsbDb, "available");
  assert.equal(result.enrichment.airLabs, "disabled");
});
