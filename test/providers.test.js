import test from "node:test";
import assert from "node:assert/strict";
import {
  isAdsbDbRoutePlausible,
  normalizeAdsbDbRoute,
} from "../backend/providers/adsbdb.js";
import { AdsbLolProvider, normalizeAdsbLolRoute } from "../backend/providers/adsblol.js";
import { normalizeAirLabsFlight } from "../backend/providers/airlabs.js";

test("normalizes an ADSB.lol route response", () => {
  const route = normalizeAdsbLolRoute({
    callsign: " UAL1783 ",
    airport_codes: "KORD-KBOS",
    plausible: true,
    _airports: [
      { iata: "ORD", icao: "KORD", lat: 41.97, lon: -87.9 },
      { iata: "BOS", icao: "KBOS", lat: 42.36, lon: -71.01 },
    ],
  });

  assert.equal(route.callsign, "UAL1783");
  assert.equal(route.origin, "ORD");
  assert.equal(route.destination, "BOS");
  assert.equal(route.waypoints.length, 2);
  assert.equal(normalizeAdsbLolRoute({
    callsign: "UAL1783",
    airport_codes: "KORD-KBOS",
    plausible: false,
  }), null);
});

test("normalizes an ADSBDB route with airport coordinates", () => {
  const route = normalizeAdsbDbRoute({
    response: {
      flightroute: {
        callsign: "JBU1155",
        callsign_icao: "JBU1155",
        origin: {
          iata_code: "BOS",
          icao_code: "KBOS",
          name: "Logan International Airport",
          latitude: 42.3643,
          longitude: -71.0052,
        },
        destination: {
          iata_code: "DCA",
          icao_code: "KDCA",
          name: "Ronald Reagan Washington National Airport",
          latitude: 38.8521,
          longitude: -77.0377,
        },
      },
    },
  });

  assert.equal(route.callsign, "JBU1155");
  assert.equal(route.origin, "BOS");
  assert.equal(route.destination, "DCA");
  assert.equal(route.waypoints[1].icao, "KDCA");
  assert.equal(route.source, "adsbdb");
  assert.equal(isAdsbDbRoutePlausible(route, {
    latitude: 42.0773,
    longitude: -71.6295,
  }), true);
  assert.equal(isAdsbDbRoutePlausible(route, {
    latitude: 34.0522,
    longitude: -118.2437,
  }), false);
});

test("falls back to ADSBDB when ADSB.lol routeset returns an empty response", async () => {
  let fallbackAircraft = null;
  const fallbackRoute = {
    callsign: "JBU1155",
    origin: "BOS",
    destination: "DCA",
    waypoints: [],
    source: "adsbdb",
  };
  const provider = new AdsbLolProvider({
    baseUrl: "https://example.test",
    userAgent: "flight-tracker-test",
    fetchImpl: async () => new Response(null, { status: 201 }),
    routeFallback: {
      fetchRoutes: async (aircraft) => {
        fallbackAircraft = aircraft;
        return new Map([["JBU1155", fallbackRoute]]);
      },
    },
  });

  const routes = await provider.fetchRoutes([{
    callsign: "JBU1155",
    latitude: 40.7,
    longitude: -73.9,
  }]);
  assert.equal(fallbackAircraft.length, 1);
  assert.equal(routes.get("JBU1155"), fallbackRoute);
});

test("normalizes AirLabs UTC route and ETA fields", () => {
  const flight = normalizeAirLabsFlight({
    flight_icao: "UAL1783",
    flight_iata: "UA1783",
    reg_number: "N17414",
    dep_iata: "ORD",
    arr_iata: "BOS",
    dep_time_utc: "2026-10-14 14:00",
    arr_estimated_utc: "2026-10-14 16:10",
    status: "en-route",
    updated: 1791990000,
  });

  assert.equal(flight.flightNumber, "UA1783");
  assert.equal(flight.origin, "ORD");
  assert.equal(flight.destination, "BOS");
  assert.equal(flight.eta, "2026-10-14T16:10:00.000Z");
  assert.equal(flight.source, "airlabs");
});
