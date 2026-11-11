import test from "node:test";
import assert from "node:assert/strict";
import {
  AdsbDbProvider,
  isAdsbDbRoutePlausible,
  normalizeAdsbDbAircraft,
  normalizeAdsbDbRoute,
} from "../backend/providers/adsbdb.js";
import { AdsbFiProvider } from "../backend/providers/adsbfi.js";
import { AdsbLolProvider, normalizeAdsbLolRoute } from "../backend/providers/adsblol.js";
import { normalizeAirLabsFlight } from "../backend/providers/airlabs.js";
import { PositionProvider } from "../backend/providers/positions.js";

test("loads aircraft from the ADSB.fi point endpoint", async () => {
  let requestedUrl = null;
  const provider = new AdsbFiProvider({
    baseUrl: "https://example.test/api/",
    userAgent: "flight-tracker-test",
    fetchImpl: async (url) => {
      requestedUrl = url;
      return Response.json({ now: 123, ac: [{ hex: "a12aa1" }] });
    },
  });

  const payload = await provider.fetchAircraft({
    latitude: 42.0773,
    longitude: -71.6295,
    radiusNm: 25,
  });

  assert.equal(
    requestedUrl,
    "https://example.test/api/v3/lat/42.0773/lon/-71.6295/dist/25",
  );
  assert.equal(payload.ac[0].hex, "a12aa1");
});

test("falls back to the secondary live-position provider", async () => {
  const attempts = [];
  const routeResult = new Map();
  const provider = new PositionProvider({
    providers: [
      {
        name: "adsb.fi",
        fetchAircraft: async () => {
          attempts.push("adsb.fi");
          throw new Error("temporary failure");
        },
      },
      {
        name: "adsb.lol",
        fetchAircraft: async () => {
          attempts.push("adsb.lol");
          return { now: 123, ac: [] };
        },
      },
    ],
    routeProvider: { fetchRoutes: async () => routeResult },
  });

  const payload = await provider.fetchAircraft({});
  assert.deepEqual(attempts, ["adsb.fi", "adsb.lol"]);
  assert.equal(payload.provider, "adsb.lol");
  assert.equal(await provider.fetchRoutes([]), routeResult);
});

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
        airline: {
          name: "JetBlue Airways",
          icao: "JBU",
          iata: "B6",
          country: "United States",
        },
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
  assert.equal(route.airline.name, "JetBlue Airways");
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

test("normalizes and caches selected-aircraft details from one ADSBDB request", async () => {
  const requests = [];
  const provider = new AdsbDbProvider({
    baseUrl: "https://example.test",
    userAgent: "flight-tracker-test",
    fetchImpl: async (url) => {
      requests.push(url);
      return Response.json({
        response: {
          aircraft: {
            type: "Embraer 175LR",
            icao_type: "E75L",
            manufacturer: "Embraer",
            mode_s: "A12AA1",
            registration: "N201JQ",
            registered_owner_country_name: "United States",
            registered_owner: "Republic Airways Inc",
          },
          flightroute: {
            callsign: "RPA5598",
            callsign_icao: "RPA5598",
            airline: { name: "Republic Airways", icao: "RPA", country: "United States" },
            origin: {
              iata_code: "BOS",
              icao_code: "KBOS",
              latitude: 42.3643,
              longitude: -71.0052,
            },
            destination: {
              iata_code: "DCA",
              icao_code: "KDCA",
              latitude: 38.8521,
              longitude: -77.0377,
            },
          },
        },
      });
    },
  });
  const aircraft = {
    id: "a12aa1",
    callsign: "RPA5598",
    latitude: 42.1,
    longitude: -71.6,
  };

  const live = await provider.fetchAircraftDetails(aircraft);
  const cached = await provider.fetchAircraftDetails(aircraft);

  assert.equal(
    requests[0],
    "https://example.test/v0/aircraft/A12AA1?callsign=RPA5598",
  );
  assert.equal(requests.length, 1);
  assert.equal(live.aircraftModel, "Embraer 175LR");
  assert.equal(live.operator, "Republic Airways");
  assert.equal(live.route.destination, "DCA");
  assert.equal(live.cache, "live");
  assert.equal(cached.cache, "cache");
});

test("normalizes ADSBDB identity without requiring route data", () => {
  const aircraft = normalizeAdsbDbAircraft({
    response: {
      aircraft: {
        mode_s: "A5E8FF",
        registration: "N480EB",
        icao_type: "B350",
        type: "King Air B350",
        manufacturer: "Hawker Beechcraft Corp",
      },
    },
  });
  assert.equal(aircraft.id, "a5e8ff");
  assert.equal(aircraft.tailNumber, "N480EB");
  assert.equal(aircraft.aircraftType, "B350");
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

test("preserves Retry-After guidance from ADSB.lol", async () => {
  const provider = new AdsbLolProvider({
    baseUrl: "https://example.test",
    userAgent: "flight-tracker-test",
    fetchImpl: async () => new Response(null, {
      status: 429,
      headers: { "Retry-After": "120" },
    }),
  });

  await assert.rejects(
    provider.fetchAircraft({ latitude: 42, longitude: -71, radiusNm: 25 }),
    (error) => {
      assert.equal(error.statusCode, 429);
      assert.equal(error.retryAfterMs, 120_000);
      return true;
    },
  );
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
