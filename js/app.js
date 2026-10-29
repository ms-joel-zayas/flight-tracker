/* =====================================================================
   FLIGHT TRACKER — JavaScript (behavior), now driven by flights.json

   The JSON file holds airports, flights and a list of "periods" (snapshots
   in time). Every periodSeconds seconds the page moves to the next period:
   the planes glide to their new positions and the details update.

   Pattern: 1. State  2. Update functions  3. Event listeners
   ===================================================================== */

const DATA_URL = "data/flights.json";


/* ---------- STEP 1. Grab the pieces of the page ---------- */
const $ = (selector) => document.querySelector(selector);

const searchInput  = $("#search-input");
const originSelect = $("#filter-origin");
const destSelect   = $("#filter-dest");
const emptyMessage = $("#empty-message");
const countBadge   = $("#count-badge");
const statusText   = $("#status-text");
const flightList   = $("#flight-list");
const mapArea      = $("#map-area");
const detailPanel  = $("#detail-panel");
const detailTitle  = $("#detail-title");
const detailClose  = $("#detail-close");

// These two lists start empty. buildPage() fills them once the data loads.
let flightRows = [];
let markers    = [];


/* ---------- STEP 2. State: the page's memory ---------- */
const state = {
  data: null,          // the whole JSON file, once loaded
  flightsById: {},     // quick lookup: "AC2210" -> flight record
  periodIndex: 0,      // which snapshot we are showing
  selectedId: null,
  search: "",
  origin: "",
  dest: ""
};


/* ---------- Helpers ---------- */

// Create an element in one line: el("span", "flight-name", "AC 2210")
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Lowercase and remove spaces so "ac 2210" matches "AC 2210".
function normalize(text) {
  return String(text).toLowerCase().replace(/\s+/g, "");
}

// Put text in an element, or "Not available" if the value is missing (null).
function setText(selector, value) {
  const node = $(selector);
  if (!node) return;
  const missing = value === null || value === undefined || value === "";
  node.textContent = missing ? "Not available" : value;
}

function setPressed(element, isPressed) {
  element.setAttribute("aria-pressed", String(isPressed));
}


/* ---------- STEP 3. Build the page from the data ---------- */
function buildPage(data) {
  // Airports: one label per airport, placed with --x and --y.
  data.airports.forEach((airport) => {
    const label = el("span", "airport", airport.code);
    label.style.setProperty("--x", airport.x + "%");
    label.style.setProperty("--y", airport.y + "%");
    label.title = airport.name;
    mapArea.append(label);
  });

  // Flights: one list row and one map marker per flight.
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

    const marker = el("button", "btn marker", flight.flight);
    marker.type = "button";
    marker.dataset.id = flight.id;
    marker.setAttribute("aria-label", flight.flight + ", " + flight.origin + " to " + flight.destination);
    setPressed(marker, false);
    marker.addEventListener("click", () => selectFlight(flight.id));
    mapArea.append(marker);

    flightRows.push(row);
    markers.push(marker);
  });

  // How long the planes take to glide between snapshots (set in the CSS).
  mapArea.style.setProperty("--move-time", data.meta.periodSeconds * 0.9 + "s");
}


/* ---------- STEP 4. Show one period (move the planes, update the data) ---------- */
// jump = true skips the gliding animation (used at start-up and when the
// replay loops back to the beginning).
function showPeriod(index, jump) {
  const period = state.data.periods[index];
  state.periodIndex = index;

  if (jump) mapArea.classList.add("no-anim");

  markers.forEach((marker) => {
    const position = period.positions[marker.dataset.id];
    marker.hidden = !position;                       // no data this period -> hide
    if (position) {
      marker.style.setProperty("--x", position.x + "%");
      marker.style.setProperty("--y", position.y + "%");
    }
  });

  if (jump) {
    void mapArea.offsetWidth;                        // let the browser apply the jump first
    mapArea.classList.remove("no-anim");
  }

  statusText.textContent = "REPLAY · " + state.data.meta.replayDate + " · " + period.time;

  if (state.selectedId) fillDetail(state.selectedId);   // keep the panel up to date
}

// Called every periodSeconds seconds.
function tick() {
  let next = state.periodIndex + 1;
  const wrapped = next >= state.data.periods.length;
  if (wrapped) next = 0;                             // loop back to the start
  showPeriod(next, wrapped);
}


/* ---------- STEP 5. Select a flight and fill the detail panel ---------- */
function fillDetail(id) {
  const flight   = state.flightsById[id];
  const position = state.data.periods[state.periodIndex].positions[id] || {};

  detailTitle.textContent = flight.flight;

  setText("#detail-origin",   flight.origin);
  setText("#detail-dest",     flight.destination);
  setText("#detail-callsign", flight.callsign);
  setText("#detail-departed", flight.departed);
  setText("#detail-eta",      flight.eta);
  setText("#detail-altitude", position.altitude == null ? null : position.altitude.toLocaleString("en-US") + " ft");
  setText("#detail-speed",    position.speed    == null ? null : position.speed + " kt");
  setText("#detail-heading",  position.heading  == null ? null : position.heading + "°");
  setText("#detail-progress", position.progress == null ? null : position.progress + "%");
}

function selectFlight(id) {
  state.selectedId = id;
  flightRows.forEach((row) => setPressed(row, row.dataset.id === id));
  markers.forEach((marker) => setPressed(marker, marker.dataset.id === id));
  fillDetail(id);
  detailPanel.hidden = false;
}

function closeDetail() {
  state.selectedId = null;
  flightRows.forEach((row) => setPressed(row, false));
  markers.forEach((marker) => setPressed(marker, false));
  detailPanel.hidden = true;
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

function renderFlights() {
  let visibleCount = 0;

  flightRows.forEach((row) => {
    const matches = flightMatches(row);
    row.parentElement.hidden = !matches;             // hide the <li> in the list

    const marker = markers.find((m) => m.dataset.id === row.dataset.id);
    if (marker) marker.classList.toggle("is-dimmed", !matches);   // dim, don't hide

    if (matches) visibleCount++;
  });

  countBadge.textContent = visibleCount + " AIRCRAFT";
  emptyMessage.hidden = visibleCount > 0;
}


/* ---------- STEP 7. Event listeners (these don't need the data) ---------- */
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


/* ---------- STEP 8. Start-up: load the JSON, then start the clock ---------- */
async function start() {
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error("HTTP " + response.status);
    state.data = await response.json();
  } catch (error) {
    console.error("Could not load " + DATA_URL + ":", error);
    console.error("If you opened index.html by double-clicking it, the browser blocks fetch(). Run a local server instead (see the instructions).");
    statusText.textContent = "DATA ERROR";
    emptyMessage.textContent = "Could not load flight data. Open the console for details.";
    emptyMessage.hidden = false;
    return;
  }

  buildPage(state.data);
  showPeriod(0, true);
  renderFlights();

  // Open with the default flight selected (set in the JSON's meta section).
  if (state.flightsById[state.data.meta.defaultFlightId]) {
    selectFlight(state.data.meta.defaultFlightId);
  }

  // The clock: move to the next period every periodSeconds seconds.
  setInterval(tick, state.data.meta.periodSeconds * 1000);
}

start();