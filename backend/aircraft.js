const EMERGENCY_SQUAWKS = Object.freeze({
  "7500": "Unlawful interference",
  "7600": "Radio communication failure",
  "7700": "General emergency",
});

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function textOrNull(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
}

export function detectEmergency(rawAircraft) {
  const squawk = textOrNull(rawAircraft.squawk);
  const broadcastEmergency = textOrNull(rawAircraft.emergency)?.toLowerCase();

  if (squawk && EMERGENCY_SQUAWKS[squawk]) {
    return { code: squawk, reason: EMERGENCY_SQUAWKS[squawk] };
  }

  if (broadcastEmergency && !["none", "no", "false"].includes(broadcastEmergency)) {
    return {
      code: broadcastEmergency,
      reason: broadcastEmergency.replaceAll("_", " "),
    };
  }

  return null;
}

export function normalizeAdsbAircraft(rawAircraft, providerTimestampMs, staleAfterSeconds) {
  const id = textOrNull(rawAircraft.hex)?.toLowerCase();
  const latitude = finiteNumber(rawAircraft.lat);
  const longitude = finiteNumber(rawAircraft.lon);

  if (!id || latitude === null || longitude === null) return null;

  const callsign = textOrNull(rawAircraft.flight)?.toUpperCase() || null;
  const dataAgeSeconds = Math.max(0, finiteNumber(rawAircraft.seen_pos) ?? finiteNumber(rawAircraft.seen) ?? 0);
  const observedAtMs = providerTimestampMs - dataAgeSeconds * 1000;
  const onGround = rawAircraft.alt_baro === "ground";

  return {
    id,
    callsign,
    flightNumber: callsign,
    tailNumber: textOrNull(rawAircraft.r)?.toUpperCase() || null,
    aircraftType: textOrNull(rawAircraft.t)?.toUpperCase() || null,
    latitude,
    longitude,
    altitudeFeet: onGround ? null : finiteNumber(rawAircraft.alt_baro),
    speedKnots: finiteNumber(rawAircraft.gs),
    headingDegrees: finiteNumber(rawAircraft.track) ?? finiteNumber(rawAircraft.true_heading),
    verticalRateFpm: finiteNumber(rawAircraft.baro_rate) ?? finiteNumber(rawAircraft.geom_rate),
    squawk: textOrNull(rawAircraft.squawk),
    onGround,
    observedAt: new Date(observedAtMs).toISOString(),
    dataAgeSeconds,
    stale: dataAgeSeconds > staleAfterSeconds,
    origin: null,
    destination: null,
    route: null,
    eta: null,
    etaSource: null,
    status: onGround ? "ground" : "airborne",
    emergency: detectEmergency(rawAircraft),
    source: "adsb.lol",
  };
}

export function applyRoute(aircraft, route) {
  if (!route) return aircraft;

  return {
    ...aircraft,
    origin: route.origin || aircraft.origin,
    destination: route.destination || aircraft.destination,
    route,
  };
}

