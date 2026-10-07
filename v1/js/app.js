/* =====================================================================
   FLIGHT TRACKER — MVP WIREFRAME BEHAVIOR (Week 6)
   JavaScript = behavior. This file only decides what happens when
   someone clicks, types, or picks something.

   There is no data source yet. Each flight's details are read straight
   from the data-* attributes on its row in index.html.

   How the file is organized:
     1. Grab the pieces of the page we need
     2. One "state" object that remembers what is going on
     3. Small functions that update the page to match the state
     4. Event listeners: "when this is clicked, call that function"
   ===================================================================== */


/* ---------- 1. Grab the pieces of the page ---------- */
const $  = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const app          = $("#app");
const sidebar      = $("#sidebar");
const panelHandle  = $("#panel-handle");
const searchInput  = $("#search-input");
const filterOrigin = $("#filter-origin");
const filterDest   = $("#filter-dest");
const emptyNote    = $("#empty-note");
const aircraftCount = $("#aircraft-count");

const detailPanel = $("#detail-panel");
const statusPill  = $("#status-pill");
const statusText  = $("#status-text");
const alertBanner = $("#alert-banner");
const replayBar   = $("#replay");

const flightRows = $$(".flight-row");   // one per flight, in the left list
const markers    = $$(".marker");       // one per flight, on the map
const paths      = $$(".path");         // trail + projected line for each flight

const ALERT_FLIGHT_ID = "AC3306";       // the flight used for the emergency demo


/* ---------- 2. State: everything the page needs to remember ---------- */
const state = {
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


/* ---------- 3. Functions that update the page ---------- */

/* Make "AC 2210", "ac2210" and "AC-2210" all look the same when searching */
function simplify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/* Does one flight match the current search and filters? (REQ-04, REQ-05) */
function flightMatches(row) {
  const d = row.dataset;
  // Safety rule: a flight with an active emergency is never hidden by search or filters
  if (state.alertOn && d.id === ALERT_FLIGHT_ID) return true;
  const searchable = simplify(d.flight + d.callsign + d.tail);
  const matchesSearch = searchable.includes(simplify(state.search));
  const matchesOrigin = state.origin === "" || d.origin === state.origin;
  const matchesDest   = state.dest === ""   || d.dest === state.dest;
  return matchesSearch && matchesOrigin && matchesDest;
}

/* Show or dim flights to match search/filters, and update the count badge */
function renderFlights() {
  let visibleCount = 0;

  flightRows.forEach((row) => {
    const visible = flightMatches(row);
    const id = row.dataset.id;
    row.parentElement.hidden = !visible;                         // list: hide non-matches
    $(`.marker[data-id="${id}"]`).classList.toggle("is-dimmed", !visible);   // map: dim non-matches
    $(`.path[data-id="${id}"]`).classList.toggle("is-dimmed", !visible);
    if (visible) visibleCount += 1;
  });

  aircraftCount.textContent = `${visibleCount} AIRCRAFT`;
  emptyNote.hidden = visibleCount > 0;

  // If the open flight was filtered out, close its panel
  if (state.selectedId) {
    const selectedRow = $(`.flight-row[data-id="${state.selectedId}"]`);
    if (!flightMatches(selectedRow)) closeDetail();
  }
}

/* Fill the detail panel from a row's data-* attributes (REQ-02, REQ-08) */
function fillDetail(row) {
  const d = row.dataset;
  $("#detail-title").textContent = d.flight;
  $("#detail-origin").textContent = d.origin;
  $("#detail-dest").textContent = d.dest;
  $("#detail-departed").textContent = d.departed;
  $("#detail-eta").textContent = d.eta;
  $("#detail-callsign").textContent = d.callsign;
  $("#detail-speed").textContent = d.speed;
  $("#detail-heading").textContent = d.heading;

  // A missing value shows a plain-language placeholder instead of a blank
  const altitude = $("#detail-altitude");
  altitude.textContent = d.altitude || "Not available";
  altitude.classList.toggle("is-missing", !d.altitude);

  $("#detail-progress-bar").style.width = `${d.progress}%`;
  $("#detail-progress").setAttribute("aria-valuenow", d.progress);
}

/* Select a flight: highlight it everywhere and open the detail panel */
function selectFlight(id) {
  state.selectedId = id;

  flightRows.forEach((row) => row.setAttribute("aria-pressed", String(row.dataset.id === id)));
  markers.forEach((m) => m.setAttribute("aria-pressed", String(m.dataset.id === id)));
  paths.forEach((p) => p.classList.toggle("is-selected", p.dataset.id === id));  // shows the dashed path (REQ-06)

  const row = $(`.flight-row[data-id="${id}"]`);
  fillDetail(row);
  detailPanel.hidden = false;
  setPanel(true);                       // make sure the left panel is visible
  row.scrollIntoView({ block: "nearest" });
}

/* Close the detail panel and clear the selection */
function closeDetail() {
  state.selectedId = null;
  flightRows.forEach((row) => row.setAttribute("aria-pressed", "false"));
  markers.forEach((m) => m.setAttribute("aria-pressed", "false"));
  paths.forEach((p) => p.classList.remove("is-selected"));
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
  let text = "LIVE · UPDATED 3s AGO";
  let mode = "live";

  if (state.mode === "replay") {
    const date = $("#replay-date").value.replace(" ▾", "").toUpperCase();
    text = `REPLAY · ${date} · ${state.speed}×`;
    mode = "replay";
  } else if (state.stale) {
    text = "⚠ DATA STALE · LAST UPDATE 12s AGO";
    mode = "stale";
  }

  statusText.textContent = text;
  statusPill.dataset.state = mode;
}

/* Emergency alert on or off (REQ-09) */
function setAlert(on) {
  state.alertOn = on;
  alertBanner.hidden = !on;
  $(`.marker[data-id="${ALERT_FLIGHT_ID}"]`).classList.toggle("is-alert", on);
  $(`.flight-row[data-id="${ALERT_FLIGHT_ID}"]`).classList.toggle("is-alert", on);
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

  if (!replaying) setPlaying(false);
  renderStatus();
}

/* Play / pause button */
function setPlaying(playing) {
  state.playing = playing;
  const button = $("#replay-play");
  button.setAttribute("aria-pressed", String(playing));
  button.setAttribute("aria-label", playing ? "Pause" : "Play");
  button.textContent = playing ? "❚❚" : "▶";
}

/* Pick a replay speed: 1×, 2×, 5× or 10× */
function setSpeed(speed) {
  state.speed = speed;
  $$("[data-speed]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.speed) === speed)));
  renderStatus();
}

/* Demo menu open/closed */
function setDemoMenu(open) {
  $("#demo-panel").hidden = !open;
  $("#demo-toggle").setAttribute("aria-expanded", String(open));
}


/* ---------- 4. Event listeners: "when this happens, do that" ---------- */

// Click a flight in the list, or an aircraft on the map
flightRows.forEach((row) => row.addEventListener("click", () => selectFlight(row.dataset.id)));
markers.forEach((marker) => marker.addEventListener("click", () => selectFlight(marker.dataset.id)));

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
  const matches = flightRows.filter(flightMatches);
  if (matches.length === 1) selectFlight(matches[0].dataset.id);
});

// Filters (REQ-05)
filterOrigin.addEventListener("change", () => { state.origin = filterOrigin.value; renderFlights(); });
filterDest.addEventListener("change",   () => { state.dest = filterDest.value;     renderFlights(); });

// Replay bar (REQ-07)
$("#mode-replay").addEventListener("click", () => setMode("replay"));
$("#mode-live").addEventListener("click", () => setMode("live"));
$("#replay-play").addEventListener("click", () => setPlaying(!state.playing));
$$("[data-speed]").forEach((button) => button.addEventListener("click", () => setSpeed(Number(button.dataset.speed))));
$("#replay-date").addEventListener("change", renderStatus);
$("#replay-back").addEventListener("click", () => { $("#replay-scrubber").stepDown(10); });
$("#replay-forward").addEventListener("click", () => { $("#replay-scrubber").stepUp(10); });

// Alert banner (REQ-09)
$("#alert-dismiss").addEventListener("click", () => { alertBanner.hidden = true; });
$("#alert-view").addEventListener("click", () => selectFlight(ALERT_FLIGHT_ID));

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

// Escape closes the demo menu first, then the detail panel
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!$("#demo-panel").hidden) setDemoMenu(false);
  else if (state.selectedId) closeDetail();
});


/* ---------- Start-up: show the app in its basic state ---------- */
renderFlights();
selectFlight("AC2210");    // open with one flight selected, like the approved wireframe
renderStatus();
