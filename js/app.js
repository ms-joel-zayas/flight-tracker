/* =====================================================================
   FLIGHT TRACKER — WEEK 12 INTERACTION + VISUALIZATION FRONTEND

   JavaScript = behavior. This file controls what happens when someone
   searches, selects an aircraft, changes replay time, or refreshes data.

   The important Week 10 boundary:
     browser -> our /api routes -> mentor-owned backend -> data providers

   The browser never calls ADSB.fi, ADSB.lol, ADSBDB, or AirLabs directly.
   It receives the same aircraft shape whether data is live or recorded.

   Week 12 additions: one selected aircraft drives the list, the map and the
   detail panel; the panel shows the four values the user needs first and keeps
   the rest under "More details"; "Route not published" replaces "— → —"; and
   the Chart tab draws altitude or speed over time with Chart.js.

   How this file is organized:
     1. Page pieces and constants
     2. State
     3. Data helpers
     4. Build and update the list and map
     5. Selected-aircraft details
     6. Loading, success, stale, and error states
     7. Replay controls
     8. Event listeners
     9. Start-up
   ===================================================================== */

import {
  ApiError,
  aircraftDescription,
  aircraftName,
  buildTimeWindow,
  currentUpdateAgeSeconds,
  formatAge,
  formatClock,
  formatVerticalRate,
  requestJson,
} from "./api.js";
import { CHART_FIELDS, buildSeries, summarizeSeries } from "./chart-data.js";

/* ---------- 1. Grab the page pieces and set shared constants ---------- */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const app = $("#app");
const panelHandle = $("#panel-handle");
const searchInput = $("#search-input");
const filterOrigin = $("#filter-origin");
const filterDest = $("#filter-dest");
const flightList = $("#flight-list");
const emptyNote = $("#empty-note");
const aircraftCount = $("#aircraft-count");
const mapArea = $("#map");
const mapNote = $("#map-note");
const detailPanel = $("#detail-panel");
const detailStatus = $("#detail-status");
const statusPill = $("#status-pill");
const statusText = $("#status-text");
const alertBanner = $("#alert-banner");
const replayBar = $("#replay");
const scrubber = $("#replay-scrubber");
const replayDate = $("#replay-date");
const periodText = $("#replay-period");

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | Aircraft data <a href="https://adsb.fi/">ADSB.fi</a> / <a href="https://adsb.lol/">ADSB.lol</a> / <a href="https://www.adsbdb.com/">ADSBDB</a>';

/* ---------- 2. State: everything the page needs to remember ---------- */
const state = {
  meta: {},
  aircraft: [],
  liveAirports: new Map(),
  replayAirports: new Map(),
  detailsById: new Map(),
  historyById: new Map(),
  replayHistoryById: new Map(),
  replayDates: [],
  replayFrames: [],
  replayTruncated: false,
  replayLoading: false,
  replayIndex: 0,
  selectedId: null,
  selectedSnapshot: null,
  selectedLastSeenAt: null,
  chartField: "altitude",
  tab: "details",
  panelOpen: true,
  search: "",
  origin: "",
  dest: "",
  mode: "live",
  playing: false,
  speed: 1,
  liveTimerId: null,
  replayTimerId: null,
  liveRequest: null,
  detailRequest: null,
  replayRequest: null,
  lastError: null,
  dismissedAlerts: new Set(),
  mapViewInitialized: false,
};

const rowById = new Map();
const markerById = new Map();
const mapMarkerById = new Map();
const pathById = new Map();

let map = null;
let airportLayer = null;
let aircraftLayer = null;
let pathLayer = null;
let suppressPopupClose = false;
let chart = null;

/* ---------- 3. Helpers for the normalized live/replay data ---------- */
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function simplify(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function displayValue(value) {
  return value === null || value === undefined || value === ""
    ? "Not available"
    : String(value);
}

// Week 11 finding: 58% of aircraft never had a route. Say so in words instead of "— → —".
function routeText(aircraft) {
  if (!aircraft.origin && !aircraft.destination) return "Route not published";
  return `${aircraft.origin || "—"} → ${aircraft.destination || "—"}`;
}

function hasLocation(item) {
  return Number.isFinite(item?.latitude)
    && Number.isFinite(item?.longitude)
    && item.latitude >= -90
    && item.latitude <= 90
    && item.longitude >= -180
    && item.longitude <= 180;
}

function toLatLng(item) {
  return [item.latitude, item.longitude];
}

function replayPoint(point) {
  const id = point.flightSessionId || point.id;
  return {
    ...point,
    id,
    aircraftId: point.id,
    emergency: point.emergencyActive ? { reason: "Emergency" } : null,
  };
}

function liveAircraftById(id) {
  return state.aircraft.find((aircraft) => aircraft.id === id) || null;
}

function replayAircraft() {
  return (state.replayFrames[state.replayIndex]?.aircraft || []).map(replayPoint);
}

function currentAircraft() {
  return state.mode === "replay" ? replayAircraft() : state.aircraft;
}

function currentAirports() {
  return state.mode === "replay" ? state.replayAirports : state.liveAirports;
}

function currentAircraftById(id) {
  const current = currentAircraft().find((aircraft) => aircraft.id === id);
  if (state.mode === "replay") return current || null;

  const detail = state.detailsById.get(id);
  if (!current || !detail) return detail || current || null;
  return {
    ...detail,
    ...current,
    flightNumber: detail.flightNumber || current.flightNumber,
    tailNumber: detail.tailNumber || current.tailNumber,
    aircraftType: detail.aircraftType || current.aircraftType,
    aircraftModel: detail.aircraftModel || current.aircraftModel,
    manufacturer: detail.manufacturer || current.manufacturer,
    operator: detail.operator || current.operator,
    registeredOwner: detail.registeredOwner || current.registeredOwner,
    registeredCountry: detail.registeredCountry || current.registeredCountry,
    origin: detail.origin || current.origin,
    destination: detail.destination || current.destination,
    route: detail.route || current.route,
    eta: detail.eta || current.eta,
    etaSource: detail.etaSource || current.etaSource,
    departureTime: detail.departureTime || current.departureTime,
    departureTimeSource: detail.departureTimeSource || current.departureTimeSource,
    status: detail.status || current.status,
    enrichment: detail.enrichment,
  };
}

function collectAirports(aircraft) {
  const airports = new Map();
  for (const item of aircraft) {
    for (const waypoint of item.route?.waypoints || []) {
      if (!waypoint.code || !hasLocation(waypoint)) continue;
      airports.set(waypoint.code, waypoint);
    }
  }
  return airports;
}

function normalizeReplayAirports(airports) {
  return new Map((airports || [])
    .filter((airport) => airport.code && hasLocation(airport))
    .map((airport) => [airport.code, airport]));
}

function flightMatches(aircraft) {
  if (aircraft.emergency) return true;
  const searchable = simplify([
    aircraftName(aircraft),
    aircraft.callsign,
    aircraft.tailNumber,
    aircraft.aircraftId,
    aircraft.id,
  ].join(" "));
  return searchable.includes(simplify(state.search))
    && (!state.origin || aircraft.origin === state.origin)
    && (!state.dest || aircraft.destination === state.dest);
}

/* ---------- 4. Build and update the flight list and Leaflet map ---------- */
function renderFilters() {
  const previousOrigin = state.origin;
  const previousDest = state.dest;
  const aircraft = currentAircraft();
  const origins = [...new Set(aircraft.map((item) => item.origin).filter(Boolean))].sort();
  const destinations = [...new Set(aircraft.map((item) => item.destination).filter(Boolean))].sort();

  filterOrigin.innerHTML = '<option value="">Origin ▾</option>'
    + origins.map((code) => `<option value="${esc(code)}">${esc(code)}</option>`).join("");
  filterDest.innerHTML = '<option value="">Dest ▾</option>'
    + destinations.map((code) => `<option value="${esc(code)}">${esc(code)}</option>`).join("");

  state.origin = origins.includes(previousOrigin) ? previousOrigin : "";
  state.dest = destinations.includes(previousDest) ? previousDest : "";
  filterOrigin.value = state.origin;
  filterDest.value = state.dest;
}

function buildFlightList() {
  rowById.clear();
  flightList.innerHTML = currentAircraft().map((item) => `
    <li>
      <button class="flight-row${item.emergency ? " is-alert" : ""}" type="button"
              data-id="${esc(item.id)}" aria-pressed="${item.id === state.selectedId}">
        <span class="flight-row__dot" aria-hidden="true"></span>
        <span class="flight-row__text">
          <strong class="flight-row__name">${esc(aircraftName(item))}</strong>
          <span class="flight-row__route${item.origin || item.destination ? "" : " is-missing"}">${esc(routeText(item))}</span>
        </span>
        <span class="flight-row__flag" aria-hidden="true">⚠</span>
      </button>
    </li>`).join("");
  $$(".flight-row", flightList).forEach((row) => rowById.set(row.dataset.id, row));
}

function initializeMap() {
  map = globalThis.L.map("map-canvas", { minZoom: 3 });
  const tiles = globalThis.L.tileLayer(TILE_URL, {
    maxZoom: 19,
    attribution: TILE_ATTRIBUTION,
    referrerPolicy: "strict-origin-when-cross-origin",
  }).addTo(map);
  tiles.on("tileerror", () => { mapNote.hidden = false; });

  airportLayer = globalThis.L.layerGroup().addTo(map);
  pathLayer = globalThis.L.layerGroup().addTo(map);
  aircraftLayer = globalThis.L.layerGroup().addTo(map);
  map.setView([42.08, -71.52], 8);

  // Clicking empty map clears the selection. A click on an aircraft marker is not "empty map".
  map.on("click", (event) => {
    if (event.originalEvent?.target?.closest?.(".marker")) return;
    if (state.selectedId) closeDetail();
  });

  map.on("popupclose", (event) => {
    if (suppressPopupClose || !state.selectedId) return;
    const selectedMarker = mapMarkerById.get(state.selectedId);
    if (selectedMarker && event.popup === selectedMarker.getPopup()) closeDetail();
  });

  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => map.invalidateSize()).observe(mapArea);
    new ResizeObserver(() => {
      mapArea.style.setProperty("--replay-height", `${replayBar.offsetHeight}px`);
    }).observe(replayBar);
  }
}

function fitLiveRegion() {
  const region = state.meta.region;
  if ([region?.latitude, region?.longitude, region?.radiusNm].every(Number.isFinite)) {
    // A circle's getBounds() needs the circle to be on the map, so build the box from the centre instead:
    // toBounds() takes the side length in metres (1 nm = 1852 m), so twice the radius.
    const bounds = globalThis.L.latLng(region.latitude, region.longitude)
      .toBounds(region.radiusNm * 1852 * 2);
    map.fitBounds(bounds, {
      paddingTopLeft: [40, 70],
      paddingBottomRight: [40, replayBar.offsetHeight + 30],
    });
    state.mapViewInitialized = true;
    return;
  }
  fitCurrentAircraft();
}

function fitCurrentAircraft() {
  const points = currentAircraft().filter(hasLocation).map(toLatLng);
  if (!points.length) return;
  map.fitBounds(points, {
    maxZoom: 9,
    paddingTopLeft: [40, 70],
    paddingBottomRight: [40, replayBar.offsetHeight + 30],
  });
  state.mapViewInitialized = true;
}

function replayTrail(id) {
  return state.replayFrames.slice(0, state.replayIndex + 1)
    .map((frame) => (frame.aircraft || []).map(replayPoint).find((item) => item.id === id))
    .filter(Boolean);
}

function liveTrail(id) {
  return state.historyById.get(id) || [];
}

// Replay frames are 15 minutes apart, so a selected replay aircraft uses its full recorded history (every 30 s).
function recordedReplayPoints(id) {
  const recorded = state.replayHistoryById.get(id);
  if (!Array.isArray(recorded)) return null;
  const untilMs = Date.parse(state.replayFrames[state.replayIndex]?.timestamp);
  return recorded.filter((point) => !Number.isFinite(untilMs) || Date.parse(point.capturedAt) <= untilMs);
}

function trailFor(aircraft) {
  const points = state.mode === "replay"
    ? recordedReplayPoints(aircraft.id) || replayTrail(aircraft.id)
    : liveTrail(aircraft.id);
  const trail = points.filter(hasLocation).map(toLatLng);
  if (hasLocation(aircraft)) {
    const last = trail.at(-1);
    if (!last || last[0] !== aircraft.latitude || last[1] !== aircraft.longitude) {
      trail.push(toLatLng(aircraft));
    }
  }
  return trail;
}

function destinationFor(aircraft) {
  const airport = currentAirports().get(aircraft.destination);
  if (hasLocation(airport)) return airport;
  return (aircraft.route?.waypoints || []).find(
    (waypoint) => waypoint.code === aircraft.destination && hasLocation(waypoint),
  ) || null;
}

function altitudeBand(altitude) {
  if (!Number.isFinite(altitude)) return "unknown";
  if (altitude < 30_000) return "low";
  if (altitude >= 35_000) return "high";
  return "mid";
}

function bearingToDestination(aircraft, destination) {
  if (Number.isFinite(aircraft.headingDegrees)) return aircraft.headingDegrees;
  if (!hasLocation(destination)) return 90;
  const latitude1 = aircraft.latitude * Math.PI / 180;
  const latitude2 = destination.latitude * Math.PI / 180;
  const deltaLongitude = (destination.longitude - aircraft.longitude) * Math.PI / 180;
  const y = Math.sin(deltaLongitude) * Math.cos(latitude2);
  const x = Math.cos(latitude1) * Math.sin(latitude2)
    - Math.sin(latitude1) * Math.cos(latitude2) * Math.cos(deltaLongitude);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function popupHtml(aircraft) {
  const route = esc(routeText(aircraft));
  const altitude = Number.isFinite(aircraft.altitudeFeet)
    ? `${Math.round(aircraft.altitudeFeet).toLocaleString()} ft`
    : aircraft.onGround ? "On ground" : "Not available";
  const speed = Number.isFinite(aircraft.speedKnots)
    ? `${Math.round(aircraft.speedKnots)} kt`
    : "Not available";
  const heading = Number.isFinite(aircraft.headingDegrees)
    ? `${Math.round(aircraft.headingDegrees)}°`
    : "Not available";
  const identityRows = [
    ["Tail", aircraft.tailNumber],
    ["Aircraft", aircraftDescription(aircraft)],
    [aircraft.operator ? "Operator" : "Registered owner", aircraft.operator || aircraft.registeredOwner],
  ].filter(([, value]) => value)
    .map(([label, value]) => `<div class="popup__row"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`)
    .join("");
  const movementRows = [
    ["Altitude", altitude],
    ["Speed", speed],
    ["Heading", heading],
    ["Vertical rate", Number.isFinite(aircraft.verticalRateFpm)
      ? formatVerticalRate(aircraft.verticalRateFpm)
      : null],
    ["Squawk", aircraft.squawk],
  ].filter(([, value]) => value)
    .map(([label, value]) => `<div class="popup__row"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`)
    .join("");
  return `
    <strong class="popup__title">${esc(aircraftName(aircraft))}</strong>
    <span class="popup__route">${route}</span>
    <dl>
      ${identityRows}
      ${movementRows}
    </dl>`;
}

function setPathClass(paths, className, enabled) {
  if (!paths) return;
  for (const path of Object.values(paths)) {
    path.getElement()?.classList.toggle(className, enabled);
  }
}

function renderMap() {
  if (!map) return;
  suppressPopupClose = true;
  airportLayer.clearLayers();
  aircraftLayer.clearLayers();
  pathLayer.clearLayers();
  markerById.clear();
  mapMarkerById.clear();
  pathById.clear();

  for (const airport of currentAirports().values()) {
    if (!hasLocation(airport)) continue;
    const icon = globalThis.L.divIcon({
      className: "",
      html: `<span class="airport"><span class="airport__sq"></span><span class="airport__code">${esc(airport.code)}</span></span>`,
      iconSize: [12, 12],
    });
    globalThis.L.marker(toLatLng(airport), {
      icon,
      interactive: false,
      keyboard: false,
    }).addTo(airportLayer);
  }

  for (const current of currentAircraft()) {
    const aircraft = currentAircraftById(current.id) || current;
    if (!hasLocation(aircraft)) continue;
    const selected = aircraft.id === state.selectedId;
    const dimmed = !flightMatches(aircraft);
    const trail = trailFor(aircraft);
    const destination = destinationFor(aircraft);
    const classes = `${selected ? " is-selected" : ""}${dimmed ? " is-dimmed" : ""}`;
    const paths = {
      trailShort: globalThis.L.polyline(trail.slice(-5), {
        className: `path__trail-short${classes}`,
        interactive: false,
      }).addTo(pathLayer),
      trailFull: globalThis.L.polyline(trail, {
        className: `path__trail-full${classes}`,
        interactive: false,
      }).addTo(pathLayer),
      projected: globalThis.L.polyline(
        destination ? [toLatLng(aircraft), toLatLng(destination)] : [],
        { className: `path__projected${classes}`, interactive: false },
      ).addTo(pathLayer),
    };
    pathById.set(aircraft.id, paths);

    const button = document.createElement("button");
    button.className = `marker${aircraft.emergency ? " is-alert" : ""}${dimmed ? " is-dimmed" : ""}`;
    button.type = "button";
    button.dataset.id = aircraft.id;
    button.dataset.band = altitudeBand(aircraft.altitudeFeet);
    button.setAttribute(
      "aria-label",
      `${aircraftName(aircraft)}, ${routeText(aircraft).replace("→", "to")}`,
    );
    button.setAttribute("aria-pressed", String(selected));
    button.style.setProperty("--rot", `${bearingToDestination(aircraft, destination) - 90}deg`);
    button.innerHTML = `<span class="marker__nose" aria-hidden="true"></span><span class="marker__label" aria-hidden="true">${esc(aircraftName(aircraft))}</span>`;
    button.addEventListener("click", () => selectFlight(aircraft.id));

    const marker = globalThis.L.marker(toLatLng(aircraft), {
      icon: globalThis.L.divIcon({ className: "", html: button, iconSize: [18, 18] }),
      interactive: false,
      keyboard: false,
      zIndexOffset: selected || aircraft.emergency ? 1000 : 0,
    }).addTo(aircraftLayer);
    marker.bindPopup(popupHtml(aircraft), {
      autoPanPaddingTopLeft: [20, 70],
      autoPanPaddingBottomRight: [20, replayBar.offsetHeight + 30],
    });
    markerById.set(aircraft.id, button);
    mapMarkerById.set(aircraft.id, marker);
  }

  suppressPopupClose = false;
  if (state.selectedId) mapMarkerById.get(state.selectedId)?.openPopup();
}

function renderFlights() {
  let visible = 0;
  for (const aircraft of currentAircraft()) {
    const matches = flightMatches(aircraft);
    const row = rowById.get(aircraft.id);
    const marker = markerById.get(aircraft.id);
    if (row) row.parentElement.hidden = !matches;
    marker?.classList.toggle("is-dimmed", !matches);
    setPathClass(pathById.get(aircraft.id), "is-dimmed", !matches);
    if (matches) visible += 1;
  }
  aircraftCount.textContent = `${visible} AIRCRAFT`;
  emptyNote.hidden = visible > 0;
  // Two different situations: nothing arrived at all, or the search/filters hide everything.
  if (currentAircraft().length === 0) {
    emptyNote.textContent = state.mode === "replay"
      ? "No recorded aircraft in this replay frame."
      : state.meta.status === "starting"
        ? "No live aircraft yet. Waiting for the first update."
        : "No aircraft in the tracking area right now.";
  } else {
    emptyNote.textContent = "No flights match your search or filters.";
  }
}

function renderSelection() {
  for (const [id, row] of rowById) {
    row.setAttribute("aria-pressed", String(id === state.selectedId));
  }
  for (const [id, marker] of markerById) {
    marker.setAttribute("aria-pressed", String(id === state.selectedId));
    mapMarkerById.get(id)?.setZIndexOffset(
      id === state.selectedId || currentAircraftById(id)?.emergency ? 1000 : 0,
    );
  }
  for (const [id, paths] of pathById) {
    setPathClass(paths, "is-selected", id === state.selectedId);
  }
}

function calculateProgress(aircraft) {
  const waypoints = aircraft.route?.waypoints || [];
  const origin = waypoints.find((point) => point.code === aircraft.origin) || waypoints[0];
  const destination = waypoints.find((point) => point.code === aircraft.destination) || waypoints.at(-1);
  if (![origin?.latitude, origin?.longitude, destination?.latitude, destination?.longitude,
    aircraft.latitude, aircraft.longitude].every(Number.isFinite)) return null;
  const latitudeScale = Math.cos(aircraft.latitude * Math.PI / 180);
  const routeX = (destination.longitude - origin.longitude) * latitudeScale;
  const routeY = destination.latitude - origin.latitude;
  const currentX = (aircraft.longitude - origin.longitude) * latitudeScale;
  const currentY = aircraft.latitude - origin.latitude;
  const denominator = routeX ** 2 + routeY ** 2;
  if (!denominator) return null;
  return Math.round(
    Math.max(0, Math.min(1, (currentX * routeX + currentY * routeY) / denominator)) * 100,
  );
}

/* ---------- Chart tab: altitude or speed over time (Chart.js) ---------- */
function replayFramePoints(id) {
  return state.replayFrames.slice(0, state.replayIndex + 1).flatMap((frame) => (frame.aircraft || [])
    .map(replayPoint)
    .filter((item) => item.id === id)
    .map((item) => ({ ...item, capturedAt: frame.timestamp })));
}

function chartSource() {
  const id = state.selectedId;
  if (state.mode === "replay") {
    const untilMs = Date.parse(state.replayFrames[state.replayIndex]?.timestamp);
    const recorded = state.replayHistoryById.get(id);
    return {
      points: Array.isArray(recorded) ? recorded : replayFramePoints(id),
      untilMs: Number.isFinite(untilMs) ? untilMs : Infinity,
      loading: recorded === undefined,
    };
  }
  return { points: state.historyById.get(id) || [], untilMs: Infinity, loading: false };
}

function formatTick(value) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function drawChart(series) {
  const { label, unit } = CHART_FIELDS[series.field];
  const ink = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#111111";
  const grid = getComputedStyle(document.documentElement).getPropertyValue("--light").trim() || "#ececec";
  const lastIndex = series.data.findLastIndex((item) => item.y !== null);
  if (!chart) {
    globalThis.Chart.defaults.font.family = getComputedStyle(document.body).fontFamily; // match the page
    chart = new globalThis.Chart($("#detail-chart"), {
      type: "line",
      data: { datasets: [{ data: [] }] },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        spanGaps: false, // a missing value is a gap, never a line drawn through data we do not have
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => formatTick(items[0].parsed.x),
              label: (item) => `${CHART_FIELDS[state.chartField].label}: ${Math.round(item.parsed.y).toLocaleString()} ${CHART_FIELDS[state.chartField].unit}`,
            },
          },
        },
        scales: {
          x: {
            type: "linear",
            title: { display: true, text: "Time" },
            ticks: { callback: (value) => formatTick(value), maxTicksLimit: 4, color: ink },
            grid: { color: grid },
          },
          y: {
            title: { display: true, text: "" },
            ticks: { callback: (value) => Number(value).toLocaleString(), maxTicksLimit: 5, color: ink },
            grid: { color: grid },
          },
        },
      },
    });
  }
  const dataset = chart.data.datasets[0];
  dataset.data = series.data;
  dataset.borderColor = ink;
  dataset.backgroundColor = ink;
  dataset.borderWidth = 2;
  dataset.tension = 0;
  // Only the newest point gets a dot: "where the aircraft is now" on the line.
  dataset.pointRadius = (context) => (context.dataIndex === lastIndex ? 4 : 0);
  chart.options.scales.y.title.text = `${label} (${unit})`;
  chart.options.scales.y.suggestedMin = series.field === "speed" ? 0 : undefined;
  chart.update("none");
}

function renderChart() {
  if (!state.selectedId) return;
  const field = state.chartField;
  const { label } = CHART_FIELDS[field];
  $("#chart-title").textContent = `${label.toUpperCase()} OVER TIME`;
  $$("[data-chart-field]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.chartField === field));
  });
  const { points, untilMs, loading } = chartSource();
  const series = buildSeries(points, field, { untilMs });
  const summary = loading ? "Loading recorded history…" : summarizeSeries(series);
  const canvas = $("#detail-chart");
  canvas.setAttribute("aria-label", `${label} over time. ${summary}`);
  if (!globalThis.Chart) {
    $("#chart-summary").textContent = `Chart library not loaded: run npm install and restart the server. ${summary}`;
    return;
  }
  $("#chart-summary").textContent = summary;
  if (state.tab === "chart") drawChart(series);
}

async function loadReplayHistory(id) {
  const aircraft = currentAircraftById(id);
  const date = replayDate.value;
  if (!aircraft?.aircraftId || !date || state.replayHistoryById.has(id)) return;
  state.replayHistoryById.set(id, undefined);
  const fromMs = Date.parse(`${date}T00:00:00.000Z`);
  const window = new URLSearchParams({
    from: new Date(fromMs).toISOString(),
    to: new Date(fromMs + ONE_DAY_MS - 1).toISOString(),
  });
  try {
    const payload = await requestJson(
      `/api/aircraft/${encodeURIComponent(aircraft.aircraftId)}/history?${window}`,
    );
    // The same aircraft can make several visits in one day: keep only this visit (flight session).
    state.replayHistoryById.set(id, (payload.points || []).filter((point) => (point.flightSessionId || point.id) === id));
  } catch {
    state.replayHistoryById.set(id, null); // fall back to the 15-minute replay frames
  }
  if (state.selectedId === id && state.mode === "replay") {
    renderChart();
    renderMap();
    renderSelection();
  }
}

/* ---------- 5. Load and show one selected aircraft ---------- */
function fillDetail(aircraft, { gone = false } = {}) {
  if (!aircraft) return;
  // The selected aircraft left the tracking area (or this replay frame): keep its last values, say so.
  detailPanel.dataset.gone = String(gone);
  const goneNote = $("#detail-gone");
  goneNote.hidden = !gone;
  goneNote.textContent = gone
    ? `Not in the tracking area ${state.mode === "replay" ? "in this frame" : "right now"}. Last seen ${formatClock(state.selectedLastSeenAt)}.`
    : "";
  $("#detail-title").textContent = aircraftName(aircraft);
  const routeKnown = Boolean(aircraft.origin || aircraft.destination);
  $("#detail-route").hidden = !routeKnown;
  $("#detail-route-missing").hidden = routeKnown;
  $("#detail-origin").textContent = aircraft.origin || "—";
  $("#detail-dest").textContent = aircraft.destination || "—";
  const observedDeparture = aircraft.departureTime || aircraft.firstObservedAt;
  $("#detail-departure-label").textContent = aircraft.departureTimeSource === "first-observed"
    ? "First observed"
    : "Departed";
  $("#detail-departed").textContent = formatClock(observedDeparture);
  $("#detail-eta-label").textContent = aircraft.etaSource === "calculated"
    ? "ETA · CALCULATED"
    : "ETA";
  $("#detail-eta").textContent = formatClock(aircraft.eta);
  $("#detail-eta").parentElement.hidden = !routeKnown; // no route, no ETA to show
  $("#detail-callsign").textContent = displayValue(aircraft.callsign);
  $("#detail-tail").textContent = displayValue(aircraft.tailNumber);
  $("#detail-aircraft").textContent = displayValue(aircraftDescription(aircraft));
  const operator = aircraft.operator || aircraft.registeredOwner;
  $("#detail-operator-label").textContent = aircraft.operator ? "Operator" : "Registered owner";
  $("#detail-operator").textContent = displayValue(operator);
  $("#detail-speed").textContent = Number.isFinite(aircraft.speedKnots)
    ? `${Math.round(aircraft.speedKnots)} kt`
    : "Not available";
  $("#detail-heading").textContent = Number.isFinite(aircraft.headingDegrees)
    ? `${Math.round(aircraft.headingDegrees)}°`
    : "Not available";
  $("#detail-vertical-rate").textContent = formatVerticalRate(aircraft.verticalRateFpm);
  $("#detail-squawk").textContent = displayValue(aircraft.squawk);
  const altitude = $("#detail-altitude");
  altitude.textContent = Number.isFinite(aircraft.altitudeFeet)
    ? `${Math.round(aircraft.altitudeFeet).toLocaleString()} ft`
    : aircraft.onGround ? "On ground" : "Not available";
  altitude.classList.toggle("is-missing", !Number.isFinite(aircraft.altitudeFeet));

  const progress = Number.isFinite(aircraft.progressPercent)
    ? aircraft.progressPercent
    : calculateProgress(aircraft);
  const progressElement = $("#detail-progress");
  progressElement.hidden = progress === null || !routeKnown;
  if (progress !== null) {
    $("#detail-progress-bar").style.width = `${progress}%`;
    progressElement.setAttribute("aria-valuenow", String(progress));
  }
  renderChart();
}

async function loadSelectedAircraft(id) {
  const aircraft = liveAircraftById(id);
  if (!aircraft) return;
  state.detailRequest?.abort();
  const controller = new AbortController();
  state.detailRequest = controller;
  detailStatus.textContent = "Loading route and history…";
  const aircraftId = aircraft.aircraftId || aircraft.id;
  const window = buildTimeWindow(ONE_HOUR_MS);
  const detailPromise = requestJson(
    `/api/aircraft/${encodeURIComponent(aircraftId)}`,
    { signal: controller.signal },
  );
  const historyPromise = requestJson(
    `/api/aircraft/${encodeURIComponent(aircraftId)}/history?${window}`,
    { signal: controller.signal },
  );

  const [detail, history] = await Promise.allSettled([detailPromise, historyPromise]);
  if (controller.signal.aborted || state.selectedId !== id) return;

  const messages = [];
  if (detail.status === "fulfilled") {
    state.detailsById.set(id, detail.value.aircraft);
    state.liveAirports = collectAirports(
      state.aircraft.map((item) => currentAircraftById(item.id) || item),
    );
  } else {
    messages.push(detail.reason.status === 404
      ? "Aircraft left the live region."
      : "Route details unavailable.");
  }
  if (history.status === "fulfilled") {
    state.historyById.set(id, history.value.points);
  } else {
    messages.push("Position history unavailable.");
  }
  detailStatus.textContent = messages.join(" ");
  fillDetail(currentAircraftById(id));
  renderMap();
  renderFlights();
  renderSelection();
}

function selectFlight(id) {
  const aircraft = currentAircraftById(id);
  if (!aircraft) return;
  state.selectedId = id;
  rememberSelected(aircraft);
  detailPanel.hidden = false;
  setPanel(true);
  renderSelection();
  fillDetail(aircraft);
  rowById.get(id)?.scrollIntoView({ block: "nearest" });
  mapMarkerById.get(id)?.openPopup();

  if (state.mode === "live") {
    loadSelectedAircraft(id).catch((error) => {
      if (error.name !== "AbortError") detailStatus.textContent = error.message;
    });
  } else {
    detailStatus.textContent = "Showing recorded replay data.";
    loadReplayHistory(id);
  }
}

// Keep the last known values of the selected aircraft, so the panel can explain where it went.
function rememberSelected(aircraft) {
  state.selectedSnapshot = aircraft;
  state.selectedLastSeenAt = state.mode === "replay"
    ? state.replayFrames[state.replayIndex]?.timestamp
    : aircraft.observedAt || state.meta.updatedAt;
}

function closeDetail() {
  state.detailRequest?.abort();
  const previousId = state.selectedId;
  state.selectedId = null;
  state.selectedSnapshot = null;
  detailPanel.hidden = true;
  detailStatus.textContent = "";
  if (previousId) {
    suppressPopupClose = true;
    mapMarkerById.get(previousId)?.closePopup();
    suppressPopupClose = false;
  }
  renderSelection();
}

function setTab(name) {
  state.tab = name;
  for (const tab of ["details", "chart"]) {
    $(`#tab-${tab}`).setAttribute("aria-selected", String(tab === name));
    $(`#view-${tab}`).hidden = tab !== name;
  }
  if (name === "chart") renderChart();
}

function setPanel(open) {
  state.panelOpen = open;
  app.dataset.panel = open ? "open" : "closed";
  panelHandle.setAttribute("aria-expanded", String(open));
  panelHandle.setAttribute("aria-label", open ? "Hide flight panel" : "Show flight panel");
  panelHandle.textContent = open ? "‹" : "›";
  setTimeout(() => map?.invalidateSize(), 0);
}

/* ---------- 6. Loading, success, stale, and error states ---------- */
function renderStatus() {
  if (state.mode === "replay") {
    const frame = state.replayFrames[state.replayIndex];
    statusText.textContent = frame
      ? `REPLAY · ${formatClock(frame.timestamp).toUpperCase()} · ${state.speed}×`
      : "REPLAY · NO RECORDED DATA";
    statusPill.dataset.state = "replay";
    return;
  }

  const updateAgeSeconds = currentUpdateAgeSeconds(state.meta);
  const staleAfterSeconds = Number(state.meta.staleAfterSeconds) || 60;
  const feedIsStale = updateAgeSeconds === null || updateAgeSeconds > staleAfterSeconds;
  const retrying = state.meta.status === "degraded" || Boolean(state.lastError);
  statusPill.title = state.lastError?.message || state.meta.warning || "";

  if (state.lastError && !state.aircraft.length) {
    statusText.textContent = "LIVE · API UNAVAILABLE";
    statusPill.dataset.state = "stale";
  } else if (state.meta.status === "starting" && state.meta.warning) {
    statusText.textContent = "LIVE · NO DATA YET · RETRYING";
    statusPill.dataset.state = "stale";
  } else if (state.meta.status === "starting") {
    statusText.textContent = "LIVE · CONNECTING";
    statusPill.dataset.state = "stale";
  } else if (feedIsStale) {
    statusText.textContent = `⚠ DATA STALE · ${formatAge(updateAgeSeconds).toUpperCase()}`;
    statusPill.dataset.state = "stale";
  } else if (retrying) {
    statusText.textContent = `LIVE · ${formatAge(updateAgeSeconds).toUpperCase()} · RETRYING`;
    statusPill.dataset.state = "warning";
  } else {
    statusText.textContent = `LIVE · ${formatAge(updateAgeSeconds).toUpperCase()}`;
    statusPill.dataset.state = "live";
  }
}

function renderPeriodText() {
  if (state.mode === "live") {
    periodText.textContent = `LIVE FEED · ${state.aircraft.length} AIRCRAFT · ${formatAge(currentUpdateAgeSeconds(state.meta)).toUpperCase()}`;
    return;
  }
  if (state.replayLoading) {
    periodText.textContent = "LOADING REPLAY…";
    return;
  }
  const frame = state.replayFrames[state.replayIndex];
  periodText.textContent = frame
    ? `FRAME ${state.replayIndex + 1} OF ${state.replayFrames.length} · ${formatClock(frame.timestamp).toUpperCase()}${state.replayTruncated ? " · LIMITED" : ""}`
    : "NO RECORDED POSITIONS FOR THIS DATE";
}

function updateReplayControls() {
  const hasFrames = state.replayFrames.length > 0;
  const enabled = state.mode === "replay" && hasFrames && !state.replayLoading;
  $$(".replay__controls button, #replay-scrubber")
    .forEach((control) => { control.disabled = !enabled; });
  replayDate.disabled = state.mode !== "replay"
    || state.replayLoading
    || state.replayDates.length === 0;
  replayBar.dataset.mode = state.mode;
  $("#mode-replay").setAttribute("aria-pressed", String(state.mode === "replay"));
  $("#mode-live").setAttribute("aria-pressed", String(state.mode === "live"));
  scrubber.min = 0;
  scrubber.max = Math.max(0, state.replayFrames.length - 1);
  scrubber.value = state.replayIndex;

  // Week 11: the recorded rows of the selected day, for analysis in a spreadsheet
  const download = $("#replay-download");
  const date = replayDate.value;
  download.hidden = state.mode !== "replay" || !date || state.replayLoading;
  if (date) {
    download.href = `/api/export?date=${encodeURIComponent(date)}&format=csv`;
    download.setAttribute("download", `flight-data-${date}.csv`);
  }
}

function renderAlert() {
  const activeIds = new Set(
    currentAircraft().filter((item) => item.emergency).map((item) => item.id),
  );
  for (const id of state.dismissedAlerts) {
    if (!activeIds.has(id)) state.dismissedAlerts.delete(id);
  }
  const alert = currentAircraft().find(
    (item) => item.emergency && !state.dismissedAlerts.has(item.id),
  );
  alertBanner.hidden = !alert;
  if (!alert) return;
  $("#alert-text").textContent = `⚠ ALERT · ${aircraftName(alert)} · ${String(alert.emergency.reason || "EMERGENCY").toUpperCase()}`;
  $("#alert-view").dataset.id = alert.id;
}

function renderCurrent() {
  // The selection survives live refreshes and replay frames. If the aircraft is gone, the panel stays
  // open with its last values and says so, instead of disappearing under the user's cursor.
  const selected = state.selectedId ? currentAircraftById(state.selectedId) : null;
  if (selected) rememberSelected(selected);
  renderFilters();
  buildFlightList();
  renderMap();
  renderFlights();
  renderSelection();
  renderAlert();
  renderStatus();
  renderPeriodText();
  updateReplayControls();
  if (state.selectedId) fillDetail(selected || state.selectedSnapshot, { gone: !selected });
}

function showLoadError(title, error) {
  $("#load-error-title").textContent = title;
  $("#load-error-text").textContent = error.message || String(error);
  $("#load-error").hidden = false;
}

function clearLoadError() {
  $("#load-error").hidden = true;
  $("#load-error-text").textContent = "";
}

function scheduleLiveRefresh(delaySeconds = null) {
  clearTimeout(state.liveTimerId);
  const seconds = delaySeconds === null
    ? Math.max(5, Number(state.meta.refreshIntervalSeconds) || 30)
    : Math.max(1, delaySeconds);
  state.liveTimerId = setTimeout(() => refreshLive(), seconds * 1000);
}

function applyLiveSnapshot(payload) {
  state.meta = payload.meta || {};
  state.aircraft = Array.isArray(payload.aircraft) ? payload.aircraft : [];
  state.liveAirports = collectAirports(state.aircraft);
  // Keep the selected aircraft's chart growing between history loads.
  const selectedLive = state.selectedId ? liveAircraftById(state.selectedId) : null;
  const history = selectedLive ? state.historyById.get(state.selectedId) : null;
  if (history) history.push({ ...selectedLive, capturedAt: selectedLive.observedAt || state.meta.updatedAt });
  state.lastError = null;
  clearLoadError();
  // The server is running but has not had one successful provider answer yet: say why on the page,
  // not only in a tooltip. This is mentor infrastructure; the server keeps retrying by itself.
  if (state.meta.status === "starting" && state.meta.warning) {
    const retryAt = Date.parse(state.meta.nextRetryAt);
    const retrySeconds = Number.isFinite(retryAt) ? Math.max(1, Math.round((retryAt - Date.now()) / 1000)) : null;
    const retryText = retrySeconds !== null
      ? ` It will try again in about ${retrySeconds} second${retrySeconds === 1 ? "" : "s"}.`
      : " It keeps retrying by itself.";
    showLoadError(
      "Waiting for live flight data",
      new Error(`The Flight Tracker server is running, but it could not reach the flight-data providers yet (${state.meta.warning}).${retryText} This is mentor infrastructure, not your code. REPLAY still works for dates that were recorded.`),
    );
  }
  if (state.mode === "live") {
    renderCurrent();
    if (!state.mapViewInitialized) fitLiveRegion();
  } else {
    renderStatus();
  }
}

async function refreshLive({ immediate = false } = {}) {
  clearTimeout(state.liveTimerId);
  if (document.hidden && !immediate) {
    scheduleLiveRefresh();
    return;
  }
  state.liveRequest?.abort();
  const controller = new AbortController();
  state.liveRequest = controller;
  let retrySeconds = null;
  try {
    applyLiveSnapshot(await requestJson("/api/aircraft", { signal: controller.signal }));
  } catch (error) {
    if (error.name === "AbortError") return;
    if (error instanceof ApiError && error.status === 503 && error.payload) {
      applyLiveSnapshot(error.payload);
    } else {
      state.lastError = error;
      retrySeconds = 5;
      if (!state.aircraft.length) showLoadError("Could not load live aircraft", error);
      renderStatus();
      renderPeriodText();
    }
  } finally {
    if (!controller.signal.aborted) scheduleLiveRefresh(retrySeconds);
  }
}

function populateReplayDates() {
  replayDate.innerHTML = state.replayDates.length
    ? state.replayDates.map((date) => `<option value="${esc(date)}">${esc(date)}</option>`).join("")
    : "<option value=\"\">No recorded dates</option>";
}

/* ---------- 7. Replay: recorded data through the same UI ---------- */
async function loadReplayDates() {
  try {
    const payload = await requestJson("/api/replay/dates");
    state.replayDates = Array.isArray(payload.dates) ? payload.dates : [];
    populateReplayDates();
  } catch (error) {
    state.replayDates = [];
    populateReplayDates();
    console.warn(`Replay dates unavailable: ${error.message}`);
  }
  updateReplayControls();
}

async function loadReplay(date = replayDate.value) {
  state.replayRequest?.abort();
  const controller = new AbortController();
  state.replayRequest = controller;
  if (state.mode === "replay") closeDetail(); // aircraft from another date are not in this replay
  state.replayHistoryById.clear();
  state.replayLoading = true;
  renderPeriodText();
  updateReplayControls();
  try {
    if (!date) {
      state.replayFrames = [];
      state.replayAirports = new Map();
      return;
    }
    const payload = await requestJson(
      `/api/replay?date=${encodeURIComponent(date)}`,
      { signal: controller.signal },
    );
    state.replayFrames = Array.isArray(payload.frames) ? payload.frames : [];
    state.replayAirports = normalizeReplayAirports(payload.airports);
    state.replayTruncated = Boolean(payload.truncated);
    state.replayIndex = 0;
    if (Array.isArray(payload.availableDates) && payload.availableDates.length) {
      state.replayDates = payload.availableDates;
      populateReplayDates();
      replayDate.value = date;
    }
    clearLoadError();
  } catch (error) {
    if (error.name === "AbortError") return;
    state.replayFrames = [];
    state.replayAirports = new Map();
    state.replayIndex = 0;
    showLoadError("Could not load replay", error);
  } finally {
    if (!controller.signal.aborted) {
      state.replayLoading = false;
      renderCurrent();
      if (state.replayFrames.length) fitCurrentAircraft();
    }
  }
}

async function setMode(mode) {
  setPlaying(false);
  if (state.mode !== mode) closeDetail();
  state.mode = mode;
  if (mode === "replay") {
    if (!state.replayDates.length) await loadReplayDates();
    renderCurrent();
    if (state.replayDates.length) await loadReplay(replayDate.value || state.replayDates[0]);
    return;
  }
  renderCurrent();
  fitLiveRegion();
}

function replayDelay() {
  const current = state.replayFrames[state.replayIndex];
  const next = state.replayFrames[state.replayIndex + 1];
  const recordedDelay = current && next
    ? Date.parse(next.timestamp) - Date.parse(current.timestamp)
    : (Number(state.meta.refreshIntervalSeconds) || 30) * 1000;
  return Math.max(250, Math.min(30_000, recordedDelay / state.speed));
}

function scheduleNextFrame() {
  clearTimeout(state.replayTimerId);
  if (!state.playing) return;
  state.replayTimerId = setTimeout(() => {
    showReplayFrame(state.replayIndex + 1);
    if (state.replayIndex >= state.replayFrames.length - 1) setPlaying(false);
    else scheduleNextFrame();
  }, replayDelay());
}

function setPlaying(playing) {
  if (playing && (state.mode !== "replay" || !state.replayFrames.length)) return;
  if (playing && state.replayIndex >= state.replayFrames.length - 1) {
    state.replayIndex = 0;
  }
  state.playing = playing;
  const button = $("#replay-play");
  button.setAttribute("aria-pressed", String(playing));
  button.setAttribute("aria-label", playing ? "Pause" : "Play");
  button.textContent = playing ? "❚❚" : "▶";
  if (playing) renderCurrent();
  scheduleNextFrame();
}

function showReplayFrame(index) {
  state.replayIndex = Math.max(0, Math.min(index, state.replayFrames.length - 1));
  renderCurrent();
  if (state.playing && state.replayIndex >= state.replayFrames.length - 1) {
    setPlaying(false);
  }
}

function goToReplayFrame(index) {
  showReplayFrame(index);
  scheduleNextFrame();
}

function setSpeed(speed) {
  state.speed = speed;
  $$("[data-speed]").forEach((button) => {
    button.setAttribute("aria-pressed", String(Number(button.dataset.speed) === speed));
  });
  renderStatus();
  scheduleNextFrame();
}

/* ---------- 8. Connect clicks and keyboard input to update functions ---------- */
function wireEvents() {
  flightList.addEventListener("click", (event) => {
    const row = event.target.closest(".flight-row");
    if (row) selectFlight(row.dataset.id);
  });
  $("#detail-close").addEventListener("click", closeDetail);
  $("#tab-details").addEventListener("click", () => setTab("details"));
  $("#tab-chart").addEventListener("click", () => setTab("chart"));
  $$("[data-chart-field]").forEach((button) => {
    button.addEventListener("click", () => {
      state.chartField = button.dataset.chartField;
      renderChart();
    });
  });
  panelHandle.addEventListener("click", () => setPanel(!state.panelOpen));

  searchInput.addEventListener("input", () => {
    state.search = searchInput.value;
    renderFlights();
  });
  searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const matches = currentAircraft().filter(flightMatches);
    if (matches.length === 1) selectFlight(matches[0].id);
  });
  filterOrigin.addEventListener("change", () => {
    state.origin = filterOrigin.value;
    renderFlights();
  });
  filterDest.addEventListener("change", () => {
    state.dest = filterDest.value;
    renderFlights();
  });

  $("#mode-replay").addEventListener("click", () => setMode("replay"));
  $("#mode-live").addEventListener("click", () => setMode("live"));
  replayDate.addEventListener("change", () => loadReplay(replayDate.value));
  $("#replay-play").addEventListener("click", () => setPlaying(!state.playing));
  $("#replay-back").addEventListener("click", () => goToReplayFrame(state.replayIndex - 1));
  $("#replay-forward").addEventListener("click", () => goToReplayFrame(state.replayIndex + 1));
  scrubber.addEventListener("input", () => goToReplayFrame(Number(scrubber.value)));
  $$("[data-speed]").forEach((button) => {
    button.addEventListener("click", () => setSpeed(Number(button.dataset.speed)));
  });

  $("#alert-dismiss").addEventListener("click", () => {
    const id = $("#alert-view").dataset.id;
    if (id) state.dismissedAlerts.add(id);
    renderAlert();
  });
  $("#alert-view").addEventListener("click", () => {
    const id = $("#alert-view").dataset.id;
    if (id) selectFlight(id);
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshLive({ immediate: true });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.selectedId) closeDetail();
  });
  window.addEventListener("beforeunload", () => {
    state.liveRequest?.abort();
    state.detailRequest?.abort();
    state.replayRequest?.abort();
    clearTimeout(state.liveTimerId);
    clearTimeout(state.replayTimerId);
  });
}

/* ---------- 9. Start-up ---------- */
async function start() {
  if (!globalThis.L) {
    showLoadError(
      "Could not load Leaflet",
      new Error("Run npm install, restart the backend, and reload the page."),
    );
    statusText.textContent = "MAP NOT LOADED";
    statusPill.dataset.state = "stale";
    return;
  }

  initializeMap();
  wireEvents();
  setPanel(true);
  updateReplayControls();
  await refreshLive({ immediate: true });
  await loadReplayDates();
}

start();
