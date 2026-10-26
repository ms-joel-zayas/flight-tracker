const EMERGENCY_SQUAWKS = Object.freeze({
  "7500": "Unlawful interference",
  "7600": "Radio communication failure",
  "7700": "General emergency",
});
const EARTH_RADIUS_NM = 3440.065;
const MIN_ETA_SPEED_KNOTS = 30;
const MAX_ETA_HOURS = 24;

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
    firstObservedAt: null,
    departureTime: null,
    departureTimeSource: null,
    eta: null,
    etaSource: null,
    progressPercent: null,
    remainingDistanceNm: null,
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

function radians(degrees) {
  return degrees * Math.PI / 180;
}

export function greatCircleDistanceNm(from, to) {
  if (![from?.latitude, from?.longitude, to?.latitude, to?.longitude]
    .every(Number.isFinite)) return null;

  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const fromLatitude = radians(from.latitude);
  const toLatitude = radians(to.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return EARTH_RADIUS_NM * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function routeAirport(aircraft, code, fallbackIndex) {
  const waypoints = aircraft.route?.waypoints || [];
  return waypoints.find((waypoint) => waypoint.code === code) || waypoints.at(fallbackIndex) || null;
}

export function applyDerivedFlightData(
  aircraft,
  capturedAtMs = Date.now(),
  recentSpeedKnots = aircraft.speedKnots,
) {
  const current = { latitude: aircraft.latitude, longitude: aircraft.longitude };
  const origin = routeAirport(aircraft, aircraft.origin, 0);
  const destination = routeAirport(aircraft, aircraft.destination, -1);
  const routeDistanceNm = greatCircleDistanceNm(origin, destination);
  const remainingDistanceNm = greatCircleDistanceNm(current, destination);
  const progressPercent = routeDistanceNm && remainingDistanceNm !== null
    ? Math.round(Math.max(0, Math.min(1, 1 - remainingDistanceNm / routeDistanceNm)) * 100)
    : null;
  const hoursRemaining = Number.isFinite(recentSpeedKnots) && recentSpeedKnots >= MIN_ETA_SPEED_KNOTS
    && remainingDistanceNm !== null
    ? remainingDistanceNm / recentSpeedKnots
    : null;
  const hasCalculatedEta = !aircraft.onGround
    && routeDistanceNm !== null
    && routeDistanceNm >= 1
    && hoursRemaining !== null
    && hoursRemaining <= MAX_ETA_HOURS;

  return {
    ...aircraft,
    progressPercent,
    remainingDistanceNm: remainingDistanceNm === null
      ? null
      : Math.round(remainingDistanceNm * 10) / 10,
    eta: hasCalculatedEta
      ? new Date(capturedAtMs + hoursRemaining * 60 * 60 * 1000).toISOString()
      : null,
    etaSource: hasCalculatedEta ? "calculated" : null,
  };
}
