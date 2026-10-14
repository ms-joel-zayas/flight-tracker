import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAdsbLolRoute } from "../backend/providers/adsblol.js";
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

