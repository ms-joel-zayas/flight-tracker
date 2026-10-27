/* =====================================================================
   FLIGHT TRACKER — MVP (Week 8 reference, branch v3-final)
   JavaScript = behavior. This file decides what happens when someone
   clicks, types, or picks something, AND it now loads the flight data.

   Where the data lives:
     data.json (project root) holds three arrays:
       airports  – code, name, and where each airport sits on the map
       flights   – one record per flight (callsign, tail number, route, times)
       periods   – up to 5 snapshots in time. Each period holds, for every
                   flight, one point on the map (x, y) plus progress,
                   altitude, speed and heading at that moment.

   Quality helpers (empty values, heading check, data summary) live in
   js/quality.js, which index.html loads before this file.

   How the file is organized:
     1. Grab the pieces of the page we need
     2. One "state" object that remembers what is going on
     3. Load data.json
     4. Build the flight list, filters, airports, markers and paths from the data
     5. Small functions that update the page to match the state
     6. The period timer (replay): one period every 5 seconds
     7. Event listeners: "when this is clicked, call that function"
     8. Start-up
   ===================================================================== */


/* ---------- 1. Grab the pieces of the page ---------- */
const $  = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const app           = $("#app");
const panelHandle   = $("#panel-handle");
const searchInput   = $("#search-input");
const filterOrigin  = $("#filter-origin");
const filterDest    = $("#filter-dest");
const flightList    = $("#flight-list");
const emptyNote     = $("#empty-note");
const aircraftCount = $("#aircraft-count");

const mapArea     = $("#map");
const mapLayer    = $("#map-layer");           // airports + markers go here
const mapPaths    = $(".map__paths");          // the SVG that holds every flight's lines
const detailPanel = $("#detail-panel");
const statusPill  = $("#status-pill");
const statusText  = $("#status-text");
const alertBanner = $("#alert-banner");
const replayBar   = $("#replay");
const scrubber    = $("#replay-scrubber");
const replayDate  = $("#replay-date");
const periodText  = $("#replay-period");

const DATA_FILE = "data.json";


/* ---------- 2. State: everything the page needs to remember ---------- */
const state = {
  // --- data (filled in from data.json) ---
  meta: {},
  airports: [],         // [{ code, name, x, y }]
  flights: [],          // [{ id, flight, callsign, tail, origin, destination, departed, eta }]
  periods: [],          // [{ period, time, positions: { [flightId]: { x, y, progress, ... } } }]

  // --- what is going on ---
  periodIndex: 0,       // which period is on the map (0 = the first one)
  timerId: null,        // the pending setTimeout that will show the next period
  selectedId: null,     // which flight is open in the detail panel
  tab: "details",       // "details" or "chart"
  panelOpen: true,      // is the left panel showing?
  search: "",
  origin: "",
  dest: "",
  alertOn: false,       // emergency demo
  stale: false,         // stale-data demo
  mode: "live",         // "live" or "replay"
  playing: false,
  speed: 1,
};

/* Look-up tables built once the data arrives: id -> record, so we never loop to find one */
const airportByCode = {};   // "JFK" -> { code, name, x, y }
const flightById    = {};   // "AC2210" -> { id, flight, ... }
const rowById       = {};   // "AC2210" -> the <button> in the list
const markerById    = {};   // "AC2210" -> the <button> on the map
const pathById      = {};   // "AC2210" -> { group, trailShort, trailFull, projected }


/* ---------- 3. Load data.json ---------- */

/* Ask the server for data.json and turn the text into a JavaScript object */
async function loadData() {
  const response = await fetch(DATA_FILE);
  if (!response.ok) throw new Error(`The server answered ${response.status} for ${DATA_FILE}.`);
  return response.json();
}

/* Check the shape of the data before the app uses it, so a typo fails loudly and clearly */
function checkData(data) {
  ["airports", "flights", "periods"].forEach((key) => {
    if (!Array.isArray(data[key]) || data[key].length === 0) throw new Error(`"${key}" must be a non-empty list in ${DATA_FILE}.`);
  });
  const airportCodes = data.airports.map((a) => a.code);
  data.flights.forEach((f) => {
    [f.origin, f.destination].forEach((code) => {
      if (!airportCodes.includes(code)) throw new Error(`${f.id} uses airport "${code}", which is not in "airports".`);
    });
    data.periods.forEach((p) => {
      if (!p.positions[f.id]) throw new Error(`Period ${p.period} has no position for ${f.id}.`);
    });
  });
}

/* Print what a person should know about the data's quality. This reports; it never stops the app. */
function reportDataQuality(data) {
  summarizeQuality(data).forEach((note) => (note.level === "warn" ? console.warn : console.info)(`Data quality · ${note.text}`));
}

/* Put the data into state and build the look-up tables */
function useData(data) {
  state.meta     = data.meta || {};
  state.airports = data.airports;
  state.flights  = data.flights;
  state.periods  = data.periods;
  data.airports.forEach((a) => { airportByCode[a.code] = a; });
  data.flights.forEach((f)  => { flightById[f.id] = f; });
}


/* ---------- 4. Build the page from the data ---------- */

/* Characters that could be read as HTML are swapped for safe ones before we put text in a template */
function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* The left list: one row per flight */
function buildFlightList() {
  flightList.innerHTML = state.flights.map((f) => `
    <li>
      <button class="flight-row" type="button" data-id="${esc(f.id)}" aria-pressed="false">
        <span class="flight-row__dot" aria-hidden="true"></span>
        <span class="flight-row__text">
          <strong class="flight-row__name">${esc(f.flight)}</strong>
          <span class="flight-row__route">${esc(f.origin)} → ${esc(f.destination)}</span>
        </span>
        <span class="flight-row__flag" aria-hidden="true">⚠</span>
      </button>
    </li>`).join("");
  $$(".flight-row", flightList).forEach((row) => { rowById[row.dataset.id] = row; });
}

/* The Origin and Dest drop-downs: one option per airport */
function buildFilters() {
  const options = state.airports.map((a) => `<option value="${esc(a.code)}">${esc(a.code)}</option>`).join("");
  filterOrigin.insertAdjacentHTML("beforeend", options);
  filterDest.insertAdjacentHTML("beforeend", options);
}

/* The map: airports, aircraft markers, and the lines for each flight */
function buildMap() {
  const airports = state.airports.map((a) => `
    <span class="airport" style="--x: ${a.x}%; --y: ${a.y}%">
      <span class="airport__sq"></span><span class="airport__code">${esc(a.code)}</span>
    </span>`).join("");

  const markers = state.flights.map((f) => `
    <button class="marker" type="button" data-id="${esc(f.id)}"
            aria-label="${esc(f.flight)}, ${esc(f.origin)} to ${esc(f.destination)}" aria-pressed="false">
      <span class="marker__nose" aria-hidden="true"></span>
      <span class="marker__label" aria-hidden="true">${esc(f.flight)}</span>
    </button>`).join("");

  mapLayer.innerHTML = airports + markers;

  // solid short line = recent trail, solid long line = whole trail, dashed = where it is going (REQ-06)
  mapPaths.innerHTML = state.flights.map((f) => `
    <g class="path" data-id="${esc(f.id)}">
      <polyline class="path__trail-short" points="" />
      <polyline class="path__trail-full" points="" />
      <polyline class="path__projected" points="" />
    </g>`).join("");

  $$(".marker", mapLayer).forEach((m) => { markerById[m.dataset.id] = m; });
  $$(".path", mapPaths).forEach((g) => {
    pathById[g.dataset.id] = {
      group:      g,
      trailShort: $(".path__trail-short", g),
      trailFull:  $(".path__trail-full", g),
      projected:  $(".path__projected", g),
    };
  });
}

/* The replay bar: date choice and one scrubber step per period */
function buildReplayBar() {
  const date = state.meta.replayDate || "Replay";
  replayDate.innerHTML = `<option>${esc(date)}</option>`;
  scrubber.min = 0;
  scrubber.max = state.periods.length - 1;
  scrubber.step = 1;

  // The demo button names the flight that data.json marks for the emergency demo
  $("#demo-alert").textContent = `Trigger emergency · ${flightById[state.meta.alertFlightId].flight}`;
}


/* ---------- 5. Functions that update the page ---------- */

/* Make "AC 2210", "ac2210" and "AC-2210" all look the same when searching */
function simplify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/* Does one flight match the current search and filters? (REQ-04, REQ-05) */
function flightMatches(flight) {
  // Safety rule: a flight with an active emergency is never hidden by search or filters
  if (state.alertOn && flight.id === state.meta.alertFlightId) return true;
  const searchable = simplify([flight.flight, flight.callsign, flight.tail].filter((v) => !isMissing(v)).join(""));   // skip empty values so "undefined" is never searchable
  const matchesSearch = searchable.includes(simplify(state.search));
  const matchesOrigin = state.origin === "" || flight.origin === state.origin;
  const matchesDest   = state.dest === ""   || flight.destination === state.dest;
  return matchesSearch && matchesOrigin && matchesDest;
}

/* Show or dim flights to match search/filters, and update the count badge */
function renderFlights() {
  let visibleCount = 0;

  state.flights.forEach((flight) => {
    const visible = flightMatches(flight);
    rowById[flight.id].parentElement.hidden = !visible;                      // list: hide non-matches
    markerById[flight.id].classList.toggle("is-dimmed", !visible);           // map: dim non-matches
    pathById[flight.id].group.classList.toggle("is-dimmed", !visible);
    if (visible) visibleCount += 1;
  });

  aircraftCount.textContent = `${visibleCount} AIRCRAFT`;
  emptyNote.hidden = visibleCount > 0;

  // If the open flight was filtered out, close its panel
  if (state.selectedId && !flightMatches(flightById[state.selectedId])) closeDetail();
}

/* The angle (in degrees) from a point toward the flight's destination, measured on screen.
   This is what turns the little tick on a marker so it points where the flight is going. */
function angleToDestination(pos, destination) {
  const box = mapArea.getBoundingClientRect();           // % of width and height are different pixel sizes
  const dx = (destination.x - pos.x) * (box.width  || 1);
  const dy = (destination.y - pos.y) * (box.height || 1);
  return Math.round(Math.atan2(dy, dx) * 180 / Math.PI);
}

/* "x,y x,y x,y" is how an SVG polyline wants its points */
function toPoints(list) {
  return list.map((p) => `${p.x},${p.y}`).join(" ");
}

/* Draw the map for the current period: move each marker and redraw its lines */
function renderMap() {
  state.flights.forEach((flight) => {
    const pos    = state.periods[state.periodIndex].positions[flight.id];
    const origin = airportByCode[flight.origin];
    const dest   = airportByCode[flight.destination];

    // Marker: a different point for each period
    const marker = markerById[flight.id];
    marker.style.setProperty("--x", `${pos.x}%`);
    marker.style.setProperty("--y", `${pos.y}%`);
    marker.style.setProperty("--rot", `${angleToDestination(pos, dest)}deg`);

    // Lines: origin -> every point so far (the trail), then current point -> destination (projected)
    const visited = state.periods.slice(0, state.periodIndex + 1).map((p) => p.positions[flight.id]);
    const trail   = [origin, ...visited];
    const path    = pathById[flight.id];
    path.trailShort.setAttribute("points", toPoints(trail.slice(-3)));
    path.trailFull.setAttribute("points", toPoints(trail));
    path.projected.setAttribute("points", toPoints([pos, dest]));
  });
}

/* Show one value in one place on the page.
   Empty values (null, missing, "") show "Not available" in gray italics; a real 0 shows as 0.
   null is an expected gap, so it is quiet. A missing key or empty text may be a typo or a bad record, so it is flagged. */
function setField(selector, value, { name, flightId, suffix = "", format = String }) {
  const result = formatValue(value, suffix, format);
  const element = $(selector);
  element.textContent = result.text;
  element.classList.toggle("is-missing", result.missing);
  if (result.kind === "missing") console.warn(`Data quality · ${flightId}: "${name}" is missing. Check the field name for a typo.`);
  if (result.kind === "empty")   console.warn(`Data quality · ${flightId}: "${name}" is empty text.`);
}

/* Fill the detail panel from the flight record + its point in the current period (REQ-02, REQ-08) */
function fillDetail(flight) {
  const pos = state.periods[state.periodIndex].positions[flight.id];
  const id = flight.id;

  $("#detail-title").textContent    = flight.flight;
  $("#detail-origin").textContent   = flight.origin;
  $("#detail-dest").textContent     = flight.destination;
  setField("#detail-departed", flight.departed, { name: "departed", flightId: id });
  setField("#detail-eta",      flight.eta,      { name: "eta",      flightId: id });
  setField("#detail-callsign", flight.callsign, { name: "callsign", flightId: id });
  setField("#detail-altitude", pos.altitude,    { name: "altitude", flightId: id, suffix: " ft", format: (n) => n.toLocaleString("en-US") });
  setField("#detail-speed",    pos.speed,       { name: "speed",    flightId: id, suffix: " kt" });
  setField("#detail-heading",  pos.heading,     { name: "heading",  flightId: id, suffix: "°" });

  const progress = isMissing(pos.progress) ? 0 : pos.progress;
  $("#detail-progress-bar").style.width = `${progress}%`;
  $("#detail-progress").setAttribute("aria-valuenow", progress);
}

/* Select a flight: highlight it everywhere and open the detail panel */
function selectFlight(id) {
  state.selectedId = id;

  state.flights.forEach((f) => {
    const isSelected = f.id === id;
    rowById[f.id].setAttribute("aria-pressed", String(isSelected));
    markerById[f.id].setAttribute("aria-pressed", String(isSelected));
    pathById[f.id].group.classList.toggle("is-selected", isSelected);   // shows the dashed path (REQ-06)
  });

  fillDetail(flightById[id]);
  detailPanel.hidden = false;
  setPanel(true);                       // make sure the left panel is visible
  rowById[id].scrollIntoView({ block: "nearest" });
}

/* Close the detail panel and clear the selection */
function closeDetail() {
  state.selectedId = null;
  state.flights.forEach((f) => {
    rowById[f.id].setAttribute("aria-pressed", "false");
    markerById[f.id].setAttribute("aria-pressed", "false");
    pathById[f.id].group.classList.remove("is-selected");
  });
  detailPanel.hidden = true;
}

/* Switch between the "Details" and "Chart" tabs */
function setTab(name) {
  state.tab = name;
  ["details", "chart"].forEach((tab) => {
    $(`#tab-${tab}`).setAttribute("aria-selected", String(tab === name));
    $(`#view-${tab}`).hidden = tab !== name;
  });
}

/* Slide the whole left panel in or out */
function setPanel(open) {
  state.panelOpen = open;
  app.dataset.panel = open ? "open" : "closed";
  panelHandle.setAttribute("aria-expanded", String(open));
  panelHandle.setAttribute("aria-label", open ? "Hide flight panel" : "Show flight panel");
  panelHandle.textContent = open ? "‹" : "›";
}

/* Header status pill: live, stale, or replay (REQ-03, REQ-07) */
function renderStatus() {
  let text = "LIVE · NO FEED YET";            // the live API is not connected yet
  let mode = "live";

  if (state.mode === "replay") {
    const time = state.periods[state.periodIndex].time;
    text = `REPLAY · ${replayDate.value.toUpperCase()} · ${time} · ${state.speed}×`;
    mode = "replay";
  } else if (state.stale) {
    text = "⚠ DATA STALE · LAST UPDATE 12s AGO";
    mode = "stale";
  }

  statusText.textContent = text;
  statusPill.dataset.state = mode;
}

/* The line of text under the replay buttons */
function renderPeriodText() {
  const period = state.periods[state.periodIndex];
  const total  = state.periods.length;
  periodText.textContent = state.mode === "replay"
    ? `PERIOD ${state.periodIndex + 1} OF ${total} · ${period.time}`
    : `LIVE FEED NOT CONNECTED · SHOWING LAST SAVED SNAPSHOT (${period.time})`;
}

/* Show one period: move everything that depends on time (map, detail panel, scrubber, status) */
function showPeriod(index) {
  state.periodIndex = Math.max(0, Math.min(index, state.periods.length - 1));   // stay inside the list
  scrubber.value = state.periodIndex;
  renderMap();
  if (state.selectedId) fillDetail(flightById[state.selectedId]);
  renderPeriodText();
  renderStatus();
}

/* Emergency alert on or off (REQ-09) */
function setAlert(on) {
  state.alertOn = on;
  alertBanner.hidden = !on;
  $("#alert-text").textContent = `⚠ ALERT · ${flightById[state.meta.alertFlightId].flight} · EMERGENCY`;
  markerById[state.meta.alertFlightId].classList.toggle("is-alert", on);
  rowById[state.meta.alertFlightId].classList.toggle("is-alert", on);
  $("#demo-alert").setAttribute("aria-pressed", String(on));
  renderFlights();                      // re-check search/filters (the alert flight is always shown)
}

/* Switch between LIVE and REPLAY (REQ-07) */
function setMode(mode) {
  state.mode = mode;
  const replaying = mode === "replay";

  replayBar.dataset.mode = mode;
  $("#mode-replay").setAttribute("aria-pressed", String(replaying));
  $("#mode-live").setAttribute("aria-pressed", String(!replaying));

  // Replay controls only work while replaying
  $$(".replay__controls button, .replay__controls select, #replay-scrubber").forEach((control) => {
    control.disabled = !replaying;
  });

  setPlaying(false);
  // Replay starts at the first period. Live has no feed yet, so it shows the most recent saved period.
  showPeriod(replaying ? 0 : state.periods.length - 1);
}

/* Pick a replay speed: 1×, 2×, 5× or 10× */
function setSpeed(speed) {
  state.speed = speed;
  $$("[data-speed]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.speed) === speed)));
  renderStatus();
  scheduleNextPeriod();                 // a new speed means a new wait time
}


/* ---------- 6. The period timer ----------
   While a replay is playing, a timer waits 5 seconds (from meta.periodSeconds in
   data.json), then shows the next period, then waits again. At 2× the wait is
   2.5 seconds, at 10× it is half a second. */

/* How long to wait before the next period, in milliseconds */
function periodDelay() {
  const seconds = state.meta.periodSeconds || 5;
  return (seconds * 1000) / state.speed;
}

/* (Re)start the countdown to the next period. Does nothing unless a replay is playing. */
function scheduleNextPeriod() {
  clearTimeout(state.timerId);
  if (!state.playing) return;
  state.timerId = setTimeout(() => {
    showPeriod(state.periodIndex + 1);
    if (state.periodIndex >= state.periods.length - 1) setPlaying(false);   // reached the end: stop
    else scheduleNextPeriod();
  }, periodDelay());
}

/* Play / pause button */
function setPlaying(playing) {
  if (playing && state.mode !== "replay") return;       // nothing to play in live mode
  // Pressing play on the last period starts the replay again from the beginning
  if (playing && state.periodIndex >= state.periods.length - 1) showPeriod(0);

  state.playing = playing;
  const button = $("#replay-play");
  button.setAttribute("aria-pressed", String(playing));
  button.setAttribute("aria-label", playing ? "Pause" : "Play");
  button.textContent = playing ? "❚❚" : "▶";
  scheduleNextPeriod();
}

/* Jump to a period (rewind, forward and the scrubber all use this) */
function goToPeriod(index) {
  showPeriod(index);
  if (state.playing && state.periodIndex >= state.periods.length - 1) setPlaying(false);
  else scheduleNextPeriod();            // restart the 5-second wait from now
}


/* Demo menu open/closed */
function setDemoMenu(open) {
  $("#demo-panel").hidden = !open;
  $("#demo-toggle").setAttribute("aria-expanded", String(open));
}


/* ---------- 7. Event listeners: "when this happens, do that" ---------- */
function wireEvents() {
  // Click a flight in the list, or an aircraft on the map. One listener on the parent
  // handles every row/marker, including ones built from data.json.
  flightList.addEventListener("click", (event) => {
    const row = event.target.closest(".flight-row");
    if (row) selectFlight(row.dataset.id);
  });
  mapLayer.addEventListener("click", (event) => {
    const marker = event.target.closest(".marker");
    if (marker) selectFlight(marker.dataset.id);
  });

  // Detail panel
  $("#detail-close").addEventListener("click", closeDetail);
  $("#tab-details").addEventListener("click", () => setTab("details"));
  $("#tab-chart").addEventListener("click", () => setTab("chart"));

  // Slide the left panel away
  panelHandle.addEventListener("click", () => setPanel(!state.panelOpen));

  // Search: filter as you type; Enter opens the flight if only one matches (REQ-04)
  searchInput.addEventListener("input", () => {
    state.search = searchInput.value;
    renderFlights();
  });
  searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const matches = state.flights.filter(flightMatches);
    if (matches.length === 1) selectFlight(matches[0].id);
  });

  // Filters (REQ-05)
  filterOrigin.addEventListener("change", () => { state.origin = filterOrigin.value; renderFlights(); });
  filterDest.addEventListener("change",   () => { state.dest = filterDest.value;     renderFlights(); });

  // Replay bar (REQ-07)
  $("#mode-replay").addEventListener("click", () => setMode("replay"));
  $("#mode-live").addEventListener("click", () => setMode("live"));
  $("#replay-play").addEventListener("click", () => setPlaying(!state.playing));
  $$("[data-speed]").forEach((button) => button.addEventListener("click", () => setSpeed(Number(button.dataset.speed))));
  replayDate.addEventListener("change", renderStatus);
  $("#replay-back").addEventListener("click", () => goToPeriod(state.periodIndex - 1));
  $("#replay-forward").addEventListener("click", () => goToPeriod(state.periodIndex + 1));
  scrubber.addEventListener("input", () => goToPeriod(Number(scrubber.value)));

  // Alert banner (REQ-09)
  $("#alert-dismiss").addEventListener("click", () => { alertBanner.hidden = true; });
  $("#alert-view").addEventListener("click", () => selectFlight(state.meta.alertFlightId));

  // Demo menu
  $("#demo-toggle").addEventListener("click", () => setDemoMenu($("#demo-panel").hidden));
  $("#demo-alert").addEventListener("click", () => setAlert(!state.alertOn));
  $("#demo-stale").addEventListener("click", () => {
    state.stale = !state.stale;
    $("#demo-stale").setAttribute("aria-pressed", String(state.stale));
    renderStatus();
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".demo")) setDemoMenu(false);   // click anywhere else closes the menu
  });

  // The marker ticks depend on the map's shape, so redraw when the window changes size
  window.addEventListener("resize", renderMap);

  // Escape closes the demo menu first, then the detail panel
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!$("#demo-panel").hidden) setDemoMenu(false);
    else if (state.selectedId) closeDetail();
  });
}


/* ---------- 8. Start-up ---------- */

/* If data.json cannot be loaded, say so on the page instead of showing an empty app */
function showLoadError(error) {
  console.error(error);
  const fromFile = location.protocol === "file:";
  $("#load-error-text").textContent = fromFile
    ? "Browsers block fetch() for pages opened by double-clicking (file://). Start a local server in the project folder " +
      "(python3 -m http.server 8000, or Live Server in VS Code) and open http://localhost:8000."
    : `${error.message} Check that data.json is in the project root and is valid JSON.`;
  $("#load-error").hidden = false;
  statusText.textContent = "DATA NOT LOADED";
  statusPill.dataset.state = "stale";
  $$("button, input, select", app).forEach((control) => { control.disabled = true; });
}

async function start() {
  try {
    const data = await loadData();
    checkData(data);
    reportDataQuality(data);
    useData(data);
  } catch (error) {
    showLoadError(error);
    return;
  }

  buildFlightList();
  buildFilters();
  buildMap();
  buildReplayBar();
  wireEvents();

  setMode("live");                                   // shows the most recent saved period (live API comes later)
  renderFlights();
  selectFlight(state.meta.defaultFlightId || state.flights[0].id);   // open with one flight selected
}

start();
