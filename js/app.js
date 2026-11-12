/* =====================================================================
   FLIGHT TRACKER — JavaScript: LIVE mode + 24-hour REPLAY

   Two modes:
   - LIVE   (today): planes refresh every 5 seconds, the clock and slider
                     tick every second, and "Updated Ns ago" counts up.
   - REPLAY (any of the past 7 days): play / pause / scrub / speed 1x-10x.

   Each date loads a "day" of 96 snapshots (one every 15 minutes).
   If data/history/YYYY-MM-DD.json exists it is used; otherwise a day is
   generated from data/flights.json (simulated traffic).

   WEEK 9: the planes and airports are drawn on a real Leaflet map.
   Every airport and every position has a lat and a lon (degrees).
   Leaflet takes a place as [lat, lon]: latitude FIRST.

   NEW: each airborne plane has a solid line behind it (path flown). The
   selected flight also gets a dashed line ahead of it (projected path).
   ===================================================================== */

const DATA_URL = "data/flights.json";

const DAY_MINUTES  = 1440;
const STEP_MINUTES = 15;    // 96 snapshots per day (slider 0..95)
const CYCLE_MINUTES  = 480;  // every flight repeats one cycle every 8 hours
const GROUND_MINUTES = 120;  // ...of which 2 hours are spent on the ground (25%)

const LIVE_REFRESH_MS     = 5000;  // how often live data refreshes
const STALE_AFTER_SECONDS = 15;    // show "connection lost" after this long

// SIMULATION ONLY. Real planes move too slowly to see on this map in a few
// seconds, so the simulated live clock runs this many times faster than real
// time (60 = every real second counts as one simulated minute).
// When you connect a REAL live data source, set this to 1.
const LIVE_DEMO_SPEEDUP = 60;


/* ---------- Time helpers ---------- */
function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function formatClock(minutes) {
  const m = Math.floor(minutes % DAY_MINUTES);
  return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
}

// HH:MM:SS, used by the live clock.
function formatClockSeconds(minutes) {
  const total = Math.floor((minutes % DAY_MINUTES) * 60);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayISO() {
  return formatDate(new Date());
}

// Minutes since midnight right now, including seconds (e.g. 845.5).
function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

// Index of the last snapshot at or before the given minute of the day.
function indexAt(data, minutes) {
  let index = 0;
  data.periods.forEach((p, i) => {
    if (toMinutes(p.time) <= minutes) index = i;
  });
  return index;
}

// Index of the last snapshot whose time has already happened today.
function currentIndex(data) {
  return indexAt(data, nowMinutes());
}


/* ---------- Day generator (simulated traffic) ---------- */
// Same date gives the same shift, so a day always replays the same way.
function dateShift(iso) {
  let sum = 0;
  for (const ch of iso) sum += ch.charCodeAt(0) * 7;
  return sum % CYCLE_MINUTES;
}

// Builds a full 24-hour day of snapshots from the sample data.
// (Replace with real historical data when you have a source.)
//
// Every flight repeats the same cycle: it flies for most of CYCLE_MINUTES and
// then sits on the ground for GROUND_MINUTES. The flights are staggered evenly,
// so at any moment about a quarter of them (2 of 8) are on the ground and the
// rest are in the air, including at midnight and at the moment live mode opens.
//
// Positions are lat and lon (degrees). A plane on the ground has NO entry in
// "positions" at all, which is normal and not a data error.
function generateDay(base, isoDate) {
  const airports = {};
  base.airports.forEach((a) => { airports[a.code] = a; });

  const n = base.flights.length;
  const slot = CYCLE_MINUTES / n;                    // gap between flights' phases
  const airMinutes = CYCLE_MINUTES - GROUND_MINUTES;
  const shift = dateShift(isoDate);
  const template = base.periods[0].positions;
  const label = new Date(isoDate + "T12:00:00")
    .toLocaleDateString("en-US", { month: "short", day: "2-digit" });
  const periods = [];

  for (let t = 0; t < DAY_MINUTES; t += STEP_MINUTES) {
    const positions = {};

    base.flights.forEach((f, i) => {
      const from = airports[f.origin];
      const to   = airports[f.destination];
      const ref  = template[f.id] || {};

      // Each flight gets its own evenly spaced slot in the cycle.
      const offset = ((i + shift) % n) * slot + (shift % slot);
      const phase  = (((t - offset) % CYCLE_MINUTES) + CYCLE_MINUTES) % CYCLE_MINUTES;

      if (phase >= airMinutes) return;               // on the ground right now

      const p    = phase / airMinutes;               // 0 = just took off, 1 = landing
      const dLat = to.lat - from.lat;
      const dLon = to.lon - from.lon;
      const ramp = Math.min(1, p / 0.1, (1 - p) / 0.1);   // climb / descend

      // Placeholder: a straight line between the airports. Real flights curve.
      // Heading is measured clockwise from north (0 = north, 90 = east).
      const meanLat = (from.lat + to.lat) / 2 * Math.PI / 180;
      const heading = Math.round((Math.atan2(dLon * Math.cos(meanLat), dLat) * 180 / Math.PI + 360) % 360);

      positions[f.id] = {
        lat: from.lat + dLat * p,
        lon: from.lon + dLon * p,
        progress: Math.round(p * 100),
        altitude: ref.altitude == null ? null : Math.max(1000, Math.round(ref.altitude * ramp / 100) * 100),
        speed: ref.speed,
        heading: heading
      };
    });

    periods.push({ period: periods.length + 1, time: formatClock(t), positions });
  }

  return { ...base, meta: { ...base.meta, replayDate: label, periodSeconds: 3 }, periods };
}

// Use a real history file if one exists, otherwise generate the day.
async function fetchDay(date) {
  try {
    const response = await fetch(`data/history/${date}.json`);
    if (response.ok) return await response.json();
  } catch (error) { /* fall through to the generated day */ }

  const response = await fetch(DATA_URL);
  if (!response.ok) throw new Error("Could not load " + DATA_URL);
  return generateDay(await response.json(), date);
}


/* ---------- STEP 1. Grab the pieces of the page ---------- */
const $ = (selector) => document.querySelector(selector);

const app          = $("#app");
const searchInput  = $("#search-input");
const originSelect = $("#filter-origin");
const destSelect   = $("#filter-dest");
const emptyMessage = $("#empty-message");
const countBadge   = $("#count-badge");
const statusText   = $("#status-text");
const updatedText  = $("#updated-text");
const modeBanner   = $("#mode-banner");
const flightList   = $("#flight-list");
const mapArea      = $("#map-area");
const detailPanel  = $("#detail-panel");
const detailTitle  = $("#detail-title");
const detailClose  = $("#detail-close");

// Live / replay controls
const modeLive         = $("#mode-live");
const modeReplay       = $("#mode-replay");
const playbackDate     = $("#playback-date");
const playbackTime     = $("#playback-time");
const playbackTimeline = $("#playback-timeline");
const playbackToggle   = $("#playback-toggle");
const playbackStart    = $("#playback-start");
const playbackEnd      = $("#playback-end");
const playbackSpeed    = $("#playback-speed");
const prevDayBtn       = $("#playback-prev-day");
const nextDayBtn       = $("#playback-next-day");

let playbackTimer = null;   // replay timer
let liveTimer     = null;   // refreshes live data every 5 s
let tickTimer     = null;   // live clock, slider and "Updated Ns ago" every 1 s
let flightRows = [];

// The Leaflet map. It is built once; airports, paths and planes live in
// layer groups so a new day can clear them and draw again.
let map = null;
let airportLayer = null;
let pathLayer = null;
let planeLayer = null;
let leafletMarkers = {};    // flight id -> Leaflet marker
let leafletPaths = {};      // flight id -> { flown, ahead, from, to }


/* ---------- STEP 2. State ---------- */
const state = {
  data: null,
  mode: "live",          // "live" or "replay"
  flightsById: {},
  date: "",              // the day currently loaded (YYYY-MM-DD)
  periodIndex: 0,
  lastIndex: 95,         // last snapshot the slider may reach
  currentPeriod: null,   // the snapshot being shown right now
  lastUpdated: Date.now(),
  stale: false,
  liveStartMinutes: 0,   // where the live clock started (minutes since midnight)
  liveStartWall: Date.now(),
  selectedId: null,
  search: "",
  origin: "",
  dest: "",
  playing: false
};


/* ---------- Helpers ---------- */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function normalize(text) {
  return String(text).toLowerCase().replace(/\s+/g, "");
}

function setText(selector, value) {
  const node = $(selector);
  if (!node) return;
  const missing = value === null || value === undefined || value === "";
  node.textContent = missing ? "Not available" : value;
  node.classList.toggle("is-missing", missing);
}

function setPressed(element, isPressed) {
  element.setAttribute("aria-pressed", String(isPressed));
}

// Leaflet takes a place as [lat, lon]: latitude FIRST, then longitude.
function toLatLng(place) {
  return [place.lat, place.lon];
}

// True only if lat and lon are real numbers in the allowed range.
// (lat: -90 to 90, lon: -180 to 180. A real 0 is fine.)
function hasUsablePosition(position) {
  return Boolean(position) &&
    Number.isFinite(position.lat) && Number.isFinite(position.lon) &&
    Math.abs(position.lat) <= 90 && Math.abs(position.lon) <= 180;
}

// Text for the popup: the value with its unit, or "Not available" if missing.
function formatValue(value, suffix) {
  if (value === null || value === undefined || value === "") return "Not available";
  const shown = typeof value === "number" ? value.toLocaleString("en-US") : value;
  return shown + (suffix || "");
}

// The HTML shown inside a marker's popup.
function popupHtml(flight, position) {
  return "<strong>" + flight.flight + "</strong><br>" +
    flight.origin + " → " + flight.destination + "<br>" +
    "Callsign: " + formatValue(flight.callsign) + "<br>" +
    "Altitude: " + formatValue(position.altitude, " ft") + "<br>" +
    "Speed: " + formatValue(position.speed, " kt");
}

// The real <button> inside a plane marker (it only exists while the marker is on the map).
function planeButton(id) {
  const marker = leafletMarkers[id];
  const element = marker && marker.getElement();
  return element ? element.querySelector("button") : null;
}

// Draw the path for one flight. Pass a position while it is airborne,
// or null when it is on the ground (the lines are then removed).
//   solid line  = from the origin airport to where the plane is now (always shown)
//   dashed line = from where the plane is now to the destination airport
//                 (its points are set here, but it is only drawn for the selected flight)
function updatePath(id, position) {
  const path = leafletPaths[id];
  if (!path) return;

  if (position) {
    const here = toLatLng(position);
    path.flown.setLatLngs([path.from, here]);
    path.ahead.setLatLngs([here, path.to]);   // only shown for the selected flight (see updateMarkerStates)
    if (!pathLayer.hasLayer(path.flown)) pathLayer.addLayer(path.flown);
  } else {
    pathLayer.removeLayer(path.flown);
    pathLayer.removeLayer(path.ahead);
  }
}


/* ---------- STEP 3. Build the page from the data ---------- */
function buildPage(data) {
  // One list row per flight. (The map markers are made in buildMap.)
  data.flights.forEach((flight) => {
    state.flightsById[flight.id] = flight;

    const row = el("button", "btn flight-row");
    row.type = "button";
    row.dataset.id = flight.id;
    row.dataset.origin = flight.origin;
    row.dataset.dest = flight.destination;
    setPressed(row, false);
    row.append(
      el("span", "flight-name", flight.flight),
      el("span", "flight-route", flight.origin + " → " + flight.destination)
    );
    row.addEventListener("click", () => selectFlight(flight.id));

    const item = el("li");
    item.append(row);
    flightList.append(item);

    flightRows.push(row);
  });
}

// Make the Leaflet map (once), then the airport labels and one marker per flight.
function buildMap(data) {
  if (!map) {
    // 1. an empty map inside <div id="map-canvas">
    map = L.map("map-canvas", { minZoom: 3 });

    // 2. the background pictures (the credit line is required by OpenStreetMap)
    const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    tiles.on("tileerror", () => {
      console.warn("Map tiles could not load (no internet?). Aircraft are still drawn.");
    });

    // Order matters: airports at the bottom, then path lines, then planes.
    airportLayer = L.layerGroup().addTo(map);
    pathLayer    = L.layerGroup().addTo(map);
    planeLayer   = L.layerGroup().addTo(map);
  }

  // Remove the previous day's airports, paths and markers.
  airportLayer.clearLayers();
  pathLayer.clearLayers();
  planeLayer.clearLayers();
  leafletMarkers = {};
  leafletPaths = {};

  // 3. zoom so every airport fits
  map.fitBounds(data.airports.map(toLatLng));

  // Airports: one label per airport, placed by lat and lon.
  data.airports.forEach((airport) => {
    L.marker(toLatLng(airport), {
      interactive: false,
      icon: L.divIcon({
        className: "airport-icon",
        html: '<span title="' + airport.name + '">' + airport.code + "</span>",
        iconSize: [40, 16]
      })
    }).addTo(airportLayer);
  });

  // 4. an aircraft: a marker drawn as HTML (a real button).
  //    It starts at [0, 0] and is NOT added to the map yet: showSnapshot()
  //    moves it to the right place, and only adds it if the position is usable.
  data.flights.forEach((flight) => {
    const icon = L.divIcon({
      className: "plane-icon",
      html: '<button type="button" class="btn plane-btn" aria-pressed="false">' + flight.flight + "</button>",
      iconSize: [84, 30],
      iconAnchor: [42, 15]
    });
    const marker = L.marker([0, 0], { icon, keyboard: false });

    // 6. a popup whose text we can change
    marker.bindPopup("");
    marker.on("click", () => selectFlight(flight.id));

    leafletMarkers[flight.id] = marker;
  });

  // 5. path lines: solid = already flown, dashed = still to fly.
  //    Their points are set in updatePath(); they are only on the map while
  //    the plane is airborne. Leaflet draws lines under markers, so the
  //    plane buttons always sit on top.
  const airportsByCode = {};
  data.airports.forEach((a) => { airportsByCode[a.code] = a; });

  data.flights.forEach((flight) => {
    const from = airportsByCode[flight.origin];
    const to   = airportsByCode[flight.destination];
    if (!from || !to) return;

    leafletPaths[flight.id] = {
      from: toLatLng(from),
      to:   toLatLng(to),
      flown: L.polyline([], { color: "#000", weight: 3, interactive: false }),
      ahead: L.polyline([], { color: "#000", weight: 2, opacity: 0.6, dashArray: "8 8", interactive: false })
    };
  });
}


/* ---------- STEP 4. Show one snapshot (live or replay) ---------- */
// (jump is kept so the rest of the code does not change. Leaflet markers move
// straight to their new place, so there is no gliding animation to skip.)
function showSnapshot(period, jump) {
  state.currentPeriod = period;

  Object.keys(leafletMarkers).forEach((id) => {
    const marker = leafletMarkers[id];
    const position = period.positions[id];

    if (hasUsablePosition(position)) {
      marker.setLatLng(toLatLng(position));
      marker.setPopupContent(popupHtml(state.flightsById[id], position));
      if (!planeLayer.hasLayer(marker)) planeLayer.addLayer(marker);   // show it
      updatePath(id, position);                                        // draw its lines
    } else {
      // No entry at all = the plane is on the ground (normal).
      // An entry with a bad or missing lat/lon = a data problem: say so.
      if (position) {
        console.warn("No usable lat/lon for " + id + " at " + period.time);
      }
      planeLayer.removeLayer(marker);                                  // leave it off the map
      updatePath(id, null);                                            // remove its lines
    }
  });

  // Clock, slider and the status pill.
  if (state.mode === "live") {
    playbackTime.textContent = period.time;
    playbackTimeline.value = period.minutes / STEP_MINUTES;
    statusText.textContent = "● LIVE · DEMO DATA";
  } else {
    playbackTime.textContent = period.time;
    playbackTimeline.value = state.periodIndex;

    const day = state.data.meta.replayDate;
    statusText.textContent = "REPLAY · " + day + " · " + period.time;
    modeBanner.textContent = "REPLAY · NOT LIVE · " + day;
  }

  updateCount();

  if (state.selectedId) fillDetail(state.selectedId);
  updateMarkerStates();     // pressed / dimmed look for the markers
}

// Replay: show snapshot number `index` of the loaded day.
function showPeriod(index, jump) {
  if (!state.data || !state.data.periods[index]) return;
  state.periodIndex = index;
  showSnapshot(state.data.periods[index], jump);
}


/* ---------- STEP 5. Select a flight and fill the detail panel ---------- */
function fillDetail(id) {
  const flight   = state.flightsById[id];
  const position = state.currentPeriod.positions[id] || {};

  detailTitle.textContent = flight.flight + (position.lat === undefined ? " (on ground)" : "");

  setText("#detail-origin",   flight.origin);
  setText("#detail-dest",     flight.destination);
  setText("#detail-callsign", flight.callsign);
  setText("#detail-departed", flight.departed);
  setText("#detail-eta",      flight.eta);
  let altitudeText;
  if (position.altitude == null) {
    altitudeText = null;                 // missing -> setText shows "Not available"
  } else if (position.altitude === 0) {
    altitudeText = "On ground";
  } else {
    altitudeText = position.altitude.toLocaleString("en-US") + " ft";
  }
  setText("#detail-altitude", altitudeText);
  setText("#detail-speed",    position.speed    == null ? null : position.speed + " kt");
  setText("#detail-heading",  position.heading  == null ? null : position.heading + "°");
  setText("#detail-progress", position.progress == null ? null : position.progress + "%");
}

function selectFlight(id) {
  state.selectedId = id;
  updateMarkerStates();
  fillDetail(id);
  detailPanel.hidden = false;

  // open the popup if this aircraft is on the map right now
  const marker = leafletMarkers[id];
  if (marker && planeLayer.hasLayer(marker)) marker.openPopup();
}

function closeDetail() {
  state.selectedId = null;
  updateMarkerStates();
  detailPanel.hidden = true;
  if (map) map.closePopup();
}

// Keep the list rows and the map markers in step with the state:
// the selected flight looks "pressed", flights that do not match the search are dimmed.
function updateMarkerStates() {
  flightRows.forEach((row) => {
    const id = row.dataset.id;
    setPressed(row, id === state.selectedId);

    const button = planeButton(id);
    if (button) {
      setPressed(button, id === state.selectedId);
      button.classList.toggle("is-dimmed", !flightMatches(row));   // dim, don't hide
    }

    // The flown line is always shown (thicker when selected). The dashed
    // projected line only appears for the selected flight, and only while it is airborne.
    const path = leafletPaths[id];
    if (path) {
      const selected = id === state.selectedId;
      const airborne = pathLayer.hasLayer(path.flown);
      path.flown.setStyle({ weight: selected ? 5 : 3 });
      if (selected && airborne) {
        if (!pathLayer.hasLayer(path.ahead)) pathLayer.addLayer(path.ahead);
      } else {
        pathLayer.removeLayer(path.ahead);
      }
    }
  });
}


/* ---------- STEP 6. Search and filters ---------- */
function flightMatches(row) {
  const flight = state.flightsById[row.dataset.id];
  const searchable = normalize([flight.id, flight.flight, flight.callsign, flight.tail].join(" "));

  const matchesSearch = searchable.includes(normalize(state.search));
  const matchesOrigin = state.origin === "" || flight.origin === state.origin;
  const matchesDest   = state.dest === ""   || flight.destination === state.dest;

  return matchesSearch && matchesOrigin && matchesDest;
}

// Count = planes in the air right now that match the search and filters.
function updateCount() {
  let airborne = 0;
  flightRows.forEach((row) => {
    const marker = leafletMarkers[row.dataset.id];
    if (flightMatches(row) && marker && planeLayer.hasLayer(marker)) airborne++;
  });
  countBadge.textContent = airborne + " AIRCRAFT";
}

function renderFlights() {
  let visibleCount = 0;

  flightRows.forEach((row) => {
    const matches = flightMatches(row);
    row.parentElement.hidden = !matches;

    if (matches) visibleCount++;
  });

  updateMarkerStates();     // dim the markers that don't match
  updateCount();
  emptyMessage.hidden = visibleCount > 0;
}


/* ---------- STEP 7. Filter and detail listeners ---------- */
detailClose.addEventListener("click", closeDetail);

searchInput.addEventListener("input", () => {
  state.search = searchInput.value;
  renderFlights();
});

originSelect.addEventListener("change", () => {
  state.origin = originSelect.value;
  renderFlights();
});

destSelect.addEventListener("change", () => {
  state.dest = destSelect.value;
  renderFlights();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeDetail();
});


/* ---------- STEP 8. LIVE mode ---------- */

// The live clock: minutes since midnight. It starts at the real time and
// then runs LIVE_DEMO_SPEEDUP times faster than real time (simulation only).
function liveMinutes() {
  const realMinutesPassed = (Date.now() - state.liveStartWall) / 60000;
  return (state.liveStartMinutes + realMinutesPassed * LIVE_DEMO_SPEEDUP) % DAY_MINUTES;
}

// Builds a snapshot for the live clock by blending the two nearest snapshots.
function buildLiveSnapshot() {
  const periods = state.data.periods;
  const t = liveMinutes();
  const i = indexAt(state.data, t);

  const a = periods[i];
  const b = periods[(i + 1) % periods.length];    // wraps past midnight
  const ta = toMinutes(a.time);
  let tb = toMinutes(b.time);
  if (tb <= ta) tb += DAY_MINUTES;

  const frac = Math.min(1, Math.max(0, (t - ta) / (tb - ta)));

  const positions = {};
  const ids = new Set([...Object.keys(a.positions), ...Object.keys(b.positions)]);

  ids.forEach((id) => {
    const pa = a.positions[id];
    const pb = b.positions[id];

    if (pa && pb) {
      positions[id] = {
        ...pa,
        lat: pa.lat + (pb.lat - pa.lat) * frac,
        lon: pa.lon + (pb.lon - pa.lon) * frac,
        progress: Math.round(pa.progress + (pb.progress - pa.progress) * frac)
      };
    } else {
      const nearest = frac < 0.5 ? pa : pb;
      if (nearest) positions[id] = nearest;
    }
  });

  return {
    index: i,
    minutes: t,
    time: formatClockSeconds(t),
    positions
  };
}

// >>> REAL LIVE DATA GOES HERE <<<
// Right now this is simulated. To use a real flight-data API later, fetch it
// here and return an object shaped like { index, minutes, time, positions },
// where positions is { "UA205": { lat, lon, progress, altitude, speed, heading } }.
// If the request fails, throw an error and the page shows "CONNECTION LOST".
async function fetchLiveSnapshot() {
  return buildLiveSnapshot();
}

// Runs every 5 seconds: get fresh data and move the planes.
async function refreshLive() {
  if (state.mode !== "live" || !state.data) return;

  try {
    const snapshot = await fetchLiveSnapshot();
    state.periodIndex = snapshot.index;
    state.lastUpdated = Date.now();
    state.stale = false;
    showSnapshot(snapshot, false);
  } catch (error) {
    console.error("Live update failed:", error);
    state.stale = true;
  }

  updateAge();
}

// Runs every second: only the "Updated Ns ago" counter. The planes, the
// clock and the slider all move together on the 5-second refresh.
function liveTick() {
  if (state.mode !== "live" || !state.data) return;
  updateAge();
}

function updateAge() {
  if (state.mode !== "live") {
    updatedText.hidden = true;
    return;
  }

  const seconds = Math.max(0, Math.floor((Date.now() - state.lastUpdated) / 1000));
  const stale = state.stale || seconds > STALE_AFTER_SECONDS;

  updatedText.hidden = false;
  updatedText.classList.toggle("is-stale", stale);
  updatedText.textContent = stale
    ? "CONNECTION LOST · last update " + seconds + "s ago"
    : "Updated " + seconds + "s ago";
}

function startLive() {
  stopLive();
  state.lastUpdated = Date.now();
  state.stale = false;

  liveTimer = setInterval(refreshLive, LIVE_REFRESH_MS);
  tickTimer = setInterval(liveTick, 1000);
  updateAge();
}

function stopLive() {
  clearInterval(liveTimer);
  clearInterval(tickTimer);
  liveTimer = null;
  tickTimer = null;
  updatedText.hidden = true;
}

// Switch the whole page between "live" and "replay" looks and controls.
function setMode(mode) {
  state.mode = mode;
  app.dataset.mode = mode;

  setPressed(modeLive,   mode === "live");
  setPressed(modeReplay, mode === "replay");

  // You can't scrub or speed up live traffic, so grey those controls out.
  const isLive = mode === "live";
  [playbackToggle, playbackStart, playbackEnd, playbackSpeed]
    .forEach((control) => { control.disabled = isLive; });

  // The slider stays usable in live mode: drag it back to review earlier today.
  playbackTimeline.disabled = false;

  updateLastIndex();

  // Live: the slider covers the whole day and moves smoothly with the clock.
  // Replay: it moves snapshot to snapshot, only up to what has already happened.
  playbackTimeline.step = isLive ? "any" : "1";
  playbackTimeline.max = isLive ? state.data.periods.length - 1 : state.lastIndex;

  modeBanner.hidden = isLive;

  if (isLive) {
    stopPlayback();
    startLive();
  } else {
    stopLive();
    updatePlaybackSpeed();
  }
}


// How far the replay slider may go. For today that is the current time only
// (the rest of today has not happened yet); other days can be replayed fully.
function updateLastIndex() {
  state.lastIndex = state.date === todayISO()
    ? indexAt(state.data, liveMinutes())
    : state.data.periods.length - 1;
}

// Dragging the slider while LIVE leaves live mode and replays today from there.
function scrubFromLive() {
  setMode("replay");
  seekPlayback(playbackTimeline.value);
}


/* ---------- STEP 9. REPLAY playback ---------- */
// Allow today and the previous six days.
function setupDatePicker() {
  const today = new Date();
  const oldest = new Date(today);
  oldest.setDate(today.getDate() - 6);

  playbackDate.min = formatDate(oldest);
  playbackDate.max = formatDate(today);
  playbackDate.value = formatDate(today);
}

function updateDayButtons() {
  prevDayBtn.disabled = playbackDate.value <= playbackDate.min;
  nextDayBtn.disabled = playbackDate.value >= playbackDate.max;
}

function stopPlayback() {
  if (playbackTimer !== null) {
    clearInterval(playbackTimer);
    playbackTimer = null;
  }
  state.playing = false;
  playbackToggle.textContent = "PLAY";
}

function startPlayback() {
  if (!state.data || state.playing || state.mode !== "replay") return;

  // Start over if the timeline is already at the end.
  if (state.periodIndex >= state.lastIndex) {
    showPeriod(0, true);
  }

  state.playing = true;
  playbackToggle.textContent = "PAUSE";

  const baseSeconds = state.data.meta.periodSeconds || 4;
  const speed = Number(playbackSpeed.value);

  playbackTimer = setInterval(() => {
    const next = state.periodIndex + 1;

    if (next > state.lastIndex) {
      stopPlayback();
      return;
    }

    showPeriod(next, false);
  }, (baseSeconds * 1000) / speed);
}

function updatePlaybackSpeed() {
  if (!state.data) return;

  // Restart the timer if playback is already running.
  if (state.playing) {
    stopPlayback();
    startPlayback();
  }
}

function seekPlayback(index) {
  if (!state.data) return;

  const safeIndex = Math.max(0, Math.min(Math.round(Number(index)), state.lastIndex));
  showPeriod(safeIndex, true);
}

// Move to the previous or next day (inside the allowed week).
function shiftDay(delta) {
  const date = new Date(playbackDate.value + "T12:00:00");
  date.setDate(date.getDate() + delta);
  const iso = formatDate(date);

  if (iso < playbackDate.min || iso > playbackDate.max) return;

  playbackDate.value = iso;
  loadDay(iso);
}


/* ---------- STEP 10. Load a day ---------- */
// Today opens in LIVE mode, any other date opens in REPLAY mode.
async function loadDay(date, mode) {
  mode = mode || (date === todayISO() ? "live" : "replay");

  updateDayButtons();
  stopPlayback();
  stopLive();
  statusText.textContent = "LOADING";

  try {
    const data = await fetchDay(date);

    if (!data.periods || data.periods.length === 0) {
      throw new Error("The selected day has no playback data.");
    }

    // Remove the previous day's list rows (buildMap clears the map layers).
    flightList.innerHTML = "";

    flightRows = [];
    state.flightsById = {};

    state.data = data;
    state.date = date;
    state.selectedId = null;
    state.periodIndex = 0;
    detailPanel.hidden = true;

    buildPage(data);
    buildMap(data);

    playbackTimeline.min = 0;
    playbackTimeline.value = 0;

    setMode(mode);   // also works out how far the slider may go

    if (mode === "live") {
      await refreshLive();
    } else {
      showPeriod(0, true);
    }

    renderFlights();

    if (data.meta.defaultFlightId && state.flightsById[data.meta.defaultFlightId]) {
      selectFlight(data.meta.defaultFlightId);
    }

    emptyMessage.textContent = "No flights match";
    emptyMessage.hidden = true;

  } catch (error) {
    console.error(error);
    stopPlayback();
    stopLive();

    statusText.textContent = "DATA UNAVAILABLE";
    emptyMessage.textContent = "No flight data is available for this date.";
    emptyMessage.hidden = false;
  }
}


/* ---------- STEP 11. Control event listeners ---------- */
// LIVE button: jump to today and go live.
modeLive.addEventListener("click", () => {
  if (state.mode === "live") return;
  playbackDate.value = todayISO();
  loadDay(todayISO(), "live");
});

// REPLAY button: replay the selected date from the start.
modeReplay.addEventListener("click", () => {
  if (state.mode === "replay") return;
  loadDay(playbackDate.value, "replay");
});

playbackToggle.addEventListener("click", () => {
  if (state.playing) stopPlayback();
  else startPlayback();
});

playbackStart.addEventListener("click", () => {
  stopPlayback();
  seekPlayback(0);
});

playbackEnd.addEventListener("click", () => {
  stopPlayback();
  seekPlayback(state.lastIndex);
});

playbackSpeed.addEventListener("change", updatePlaybackSpeed);

playbackTimeline.addEventListener("input", () => {
  if (state.mode === "live") scrubFromLive();
  else seekPlayback(playbackTimeline.value);
});

playbackDate.addEventListener("change", () => {
  loadDay(playbackDate.value);
});

prevDayBtn.addEventListener("click", () => shiftDay(-1));
nextDayBtn.addEventListener("click", () => shiftDay(1));


/* ---------- STEP 12. Start-up ---------- */
async function start() {
  // Leaflet must be loaded (npm install, then the script tag in index.html).
  if (typeof L === "undefined") {
    console.error("Leaflet did not load. Did you run npm install? Is the script path in index.html right?");
    statusText.textContent = "MAP ERROR";
    emptyMessage.textContent = "Could not load Leaflet. Run npm install in the project folder, then reload the page.";
    emptyMessage.hidden = false;
    return;
  }

  // The clock starts at the real time of day and keeps running in both modes,
  // so "what has already happened today" is the same in live and replay.
  state.liveStartMinutes = nowMinutes();
  state.liveStartWall = Date.now();

  setupDatePicker();
  await loadDay(playbackDate.value);   // today -> opens in LIVE mode
}

start();