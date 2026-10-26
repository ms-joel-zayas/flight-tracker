import {
  ApiError,
  aircraftName,
  buildTimeWindow,
  collectAirports,
  formatAge,
  formatClock,
  projectPosition,
  projectedAircraft,
  requestJson,
} from "./api.js";

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
const mapLayer = $("#map-layer");
const mapPaths = $(".map__paths");
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

const state = {
  meta: {},
  aircraft: [],
  airports: new Map(),
  detailsById: new Map(),
  historyById: new Map(),
  replayFrames: [],
  replayTruncated: false,
  replayLoading: false,
  replayIndex: 0,
  selectedId: null,
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
};

const rowById = new Map();
const markerById = new Map();
const pathById = new Map();

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function displayValue(value, suffix = "") {
  return value === null || value === undefined || value === ""
    ? "Not available"
    : `${value}${suffix}`;
}

function simplify(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function liveAircraftById(id) {
  return state.aircraft.find((aircraft) => aircraft.id === id) || null;
}

function replayAircraft() {
  const frame = state.replayFrames[state.replayIndex];
  if (!frame) return [];
  return frame.aircraft.map((point) => {
    const live = liveAircraftById(point.id) || {};
    return {
      ...live,
      ...point,
      emergency: point.emergencyActive ? { reason: "Emergency" } : null,
    };
  });
}

function currentAircraft() {
  return state.mode === "replay" ? replayAircraft() : state.aircraft;
}

function projectedCurrentAircraft() {
  return currentAircraft()
    .map((aircraft) => projectedAircraft(aircraft, state.meta.region))
    .filter(Boolean);
}

function currentAircraftById(id) {
  const current = currentAircraft().find((aircraft) => aircraft.id === id) || liveAircraftById(id);
  const detail = state.detailsById.get(id);
  if (!current || !detail) return detail || current;
  return {
    ...detail,
    ...current,
    flightNumber: detail.flightNumber || current.flightNumber,
    tailNumber: detail.tailNumber || current.tailNumber,
    origin: detail.origin || current.origin,
    destination: detail.destination || current.destination,
    eta: detail.eta || current.eta,
    etaSource: detail.etaSource || current.etaSource,
    departureTime: detail.departureTime || current.departureTime,
    enrichment: detail.enrichment,
  };
}

function flightMatches(aircraft) {
  if (aircraft.emergency) return true;
  const searchable = simplify([
    aircraftName(aircraft),
    aircraft.callsign,
    aircraft.tailNumber,
    aircraft.id,
  ].join(" "));
  return searchable.includes(simplify(state.search))
    && (!state.origin || aircraft.origin === state.origin)
    && (!state.dest || aircraft.destination === state.dest);
}

function renderFilters() {
  const previousOrigin = state.origin;
  const previousDest = state.dest;
  const origins = [...new Set(state.aircraft.map((item) => item.origin).filter(Boolean))].sort();
  const destinations = [...new Set(state.aircraft.map((item) => item.destination).filter(Boolean))].sort();

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
  const aircraft = currentAircraft();
  flightList.innerHTML = aircraft.map((item) => `
    <li>
      <button class="flight-row${item.emergency ? " is-alert" : ""}" type="button"
              data-id="${esc(item.id)}" aria-pressed="${item.id === state.selectedId}">
        <span class="flight-row__dot" aria-hidden="true"></span>
        <span class="flight-row__text">
          <strong class="flight-row__name">${esc(aircraftName(item))}</strong>
          <span class="flight-row__route">${esc(item.origin || "—")} → ${esc(item.destination || "—")}</span>
        </span>
        <span class="flight-row__flag" aria-hidden="true">⚠</span>
      </button>
    </li>`).join("");
  $$(".flight-row", flightList).forEach((row) => rowById.set(row.dataset.id, row));
}

function pointInsideMap(point) {
  return point && point.x >= 0 && point.x <= 100 && point.y >= 0 && point.y <= 100;
}

function buildMap() {
  markerById.clear();
  pathById.clear();
  const aircraft = projectedCurrentAircraft();
  const airports = [...state.airports.values()]
    .filter(pointInsideMap)
    .map((airport) => `
      <span class="airport" style="--x:${airport.x}%;--y:${airport.y}%">
        <span class="airport__sq"></span><span class="airport__code">${esc(airport.code)}</span>
      </span>`).join("");
  const markers = aircraft.map((item) => `
    <button class="marker${item.emergency ? " is-alert" : ""}" type="button" data-id="${esc(item.id)}"
            aria-label="${esc(aircraftName(item))}, ${esc(item.origin || "unknown origin")} to ${esc(item.destination || "unknown destination")}"
            aria-pressed="${item.id === state.selectedId}">
      <span class="marker__nose" aria-hidden="true"></span>
      <span class="marker__label" aria-hidden="true">${esc(aircraftName(item))}</span>
    </button>`).join("");
  mapLayer.innerHTML = airports + markers;

  mapPaths.innerHTML = aircraft.map((item) => `
    <g class="path${item.id === state.selectedId ? " is-selected" : ""}" data-id="${esc(item.id)}">
      <polyline class="path__trail-short" points="" />
      <polyline class="path__trail-full" points="" />
      <polyline class="path__projected" points="" />
    </g>`).join("");

  $$(".marker", mapLayer).forEach((marker) => markerById.set(marker.dataset.id, marker));
  $$(".path", mapPaths).forEach((group) => pathById.set(group.dataset.id, {
    group,
    trailShort: $(".path__trail-short", group),
    trailFull: $(".path__trail-full", group),
    projected: $(".path__projected", group),
  }));
}

function toPoints(points) {
  return points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
}

function clipRayToMap(from, destination) {
  if (!from || !destination) return null;
  const dx = destination.x - from.x;
  const dy = destination.y - from.y;
  let scale = 1;
  if (dx > 0) scale = Math.min(scale, (100 - from.x) / dx);
  if (dx < 0) scale = Math.min(scale, (0 - from.x) / dx);
  if (dy > 0) scale = Math.min(scale, (100 - from.y) / dy);
  if (dy < 0) scale = Math.min(scale, (0 - from.y) / dy);
  return { x: from.x + dx * scale, y: from.y + dy * scale };
}

function replayTrail(id) {
  return state.replayFrames.slice(0, state.replayIndex + 1)
    .map((frame) => frame.aircraft.find((item) => item.id === id))
    .filter(Boolean);
}

function liveTrail(id) {
  return state.historyById.get(id) || [];
}

function renderMap() {
  for (const aircraft of projectedCurrentAircraft()) {
    const marker = markerById.get(aircraft.id);
    const path = pathById.get(aircraft.id);
    if (!marker || !path) continue;

    marker.style.setProperty("--x", `${aircraft.x}%`);
    marker.style.setProperty("--y", `${aircraft.y}%`);
    let rotation = Number.isFinite(aircraft.headingDegrees) ? aircraft.headingDegrees - 90 : 0;
    const destination = state.airports.get(aircraft.destination);
    if (!Number.isFinite(aircraft.headingDegrees) && destination) {
      rotation = Math.atan2(destination.y - aircraft.y, destination.x - aircraft.x) * 180 / Math.PI;
    }
    marker.style.setProperty("--rot", `${rotation}deg`);

    const rawTrail = state.mode === "replay" ? replayTrail(aircraft.id) : liveTrail(aircraft.id);
    const trail = rawTrail
      .map((point) => projectPosition(point.latitude, point.longitude, state.meta.region))
      .filter(Boolean);
    if (!trail.length || trail.at(-1).x !== aircraft.x || trail.at(-1).y !== aircraft.y) {
      trail.push({ x: aircraft.x, y: aircraft.y });
    }
    path.trailShort.setAttribute("points", toPoints(trail.slice(-5)));
    path.trailFull.setAttribute("points", toPoints(trail));
    const projectedDestination = destination ? clipRayToMap(aircraft, destination) : null;
    path.projected.setAttribute(
      "points",
      projectedDestination ? toPoints([aircraft, projectedDestination]) : "",
    );
  }
}

function renderFlights() {
  let visible = 0;
  for (const aircraft of currentAircraft()) {
    const matches = flightMatches(aircraft);
    const row = rowById.get(aircraft.id);
    const marker = markerById.get(aircraft.id);
    const path = pathById.get(aircraft.id);
    if (row) row.parentElement.hidden = !matches;
    marker?.classList.toggle("is-dimmed", !matches);
    path?.group.classList.toggle("is-dimmed", !matches);
    if (matches) visible += 1;
  }
  aircraftCount.textContent = `${visible} AIRCRAFT`;
  emptyNote.hidden = visible > 0;
}

function renderSelection() {
  for (const [id, row] of rowById) row.setAttribute("aria-pressed", String(id === state.selectedId));
  for (const [id, marker] of markerById) marker.setAttribute("aria-pressed", String(id === state.selectedId));
  for (const [id, path] of pathById) path.group.classList.toggle("is-selected", id === state.selectedId);
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
  return Math.round(Math.max(0, Math.min(1, (currentX * routeX + currentY * routeY) / denominator)) * 100);
}

function renderChart() {
  const points = state.mode === "replay"
    ? replayTrail(state.selectedId)
    : state.historyById.get(state.selectedId) || [];
  const samples = points.filter((point) => Number.isFinite(point.altitudeFeet));
  const polyline = $("#altitude-chart-line");
  const note = $("#altitude-chart-note");
  if (samples.length < 2) {
    polyline.setAttribute("points", "");
    note.textContent = "Altitude history is not available yet.";
    return;
  }
  const altitudes = samples.map((point) => point.altitudeFeet);
  const minimum = Math.min(...altitudes);
  const maximum = Math.max(...altitudes);
  const range = Math.max(maximum - minimum, 1);
  const graph = samples.map((point, index) => ({
    x: 4 + (index / (samples.length - 1)) * 192,
    y: 62 - ((point.altitudeFeet - minimum) / range) * 54,
  }));
  polyline.setAttribute("points", toPoints(graph));
  note.textContent = `${samples.length} samples · ${minimum.toLocaleString()}–${maximum.toLocaleString()} ft`;
}

function fillDetail(aircraft) {
  if (!aircraft) return;
  $("#detail-title").textContent = aircraftName(aircraft);
  $("#detail-origin").textContent = aircraft.origin || "—";
  $("#detail-dest").textContent = aircraft.destination || "—";
  const observedDeparture = aircraft.departureTime || aircraft.firstObservedAt;
  $("#detail-departure-label").textContent = aircraft.departureTimeSource === "first-observed"
    ? "First observed"
    : "Departed";
  $("#detail-departed").textContent = formatClock(observedDeparture);
  $("#detail-eta-label").textContent = aircraft.etaSource === "calculated" ? "ETA · CALCULATED" : "ETA";
  $("#detail-eta").textContent = formatClock(aircraft.eta);
  $("#detail-callsign").textContent = displayValue(aircraft.callsign);
  $("#detail-speed").textContent = Number.isFinite(aircraft.speedKnots)
    ? `${Math.round(aircraft.speedKnots)} kt`
    : "Not available";
  $("#detail-heading").textContent = Number.isFinite(aircraft.headingDegrees)
    ? `${Math.round(aircraft.headingDegrees)}°`
    : "Not available";
  const altitude = $("#detail-altitude");
  altitude.textContent = Number.isFinite(aircraft.altitudeFeet)
    ? `${Math.round(aircraft.altitudeFeet).toLocaleString()} ft`
    : aircraft.onGround ? "On ground" : "Not available";
  altitude.classList.toggle("is-missing", !Number.isFinite(aircraft.altitudeFeet));

  const progress = Number.isFinite(aircraft.progressPercent)
    ? aircraft.progressPercent
    : calculateProgress(aircraft);
  const progressElement = $("#detail-progress");
  progressElement.hidden = progress === null;
  if (progress !== null) {
    $("#detail-progress-bar").style.width = `${progress}%`;
    progressElement.setAttribute("aria-valuenow", progress);
  }
  renderChart();
}

async function loadSelectedAircraft(id) {
  state.detailRequest?.abort();
  const controller = new AbortController();
  state.detailRequest = controller;
  detailStatus.textContent = "Loading route and history…";

  const window = buildTimeWindow(ONE_HOUR_MS);
  const detailPromise = requestJson(`/api/aircraft/${encodeURIComponent(id)}`, { signal: controller.signal });
  const historyPromise = requestJson(
    `/api/aircraft/${encodeURIComponent(id)}/history?${window}`,
    { signal: controller.signal },
  );

  const [detail, history] = await Promise.allSettled([detailPromise, historyPromise]);
  if (controller.signal.aborted || state.selectedId !== id) return;

  const messages = [];
  if (detail.status === "fulfilled") {
    state.detailsById.set(id, detail.value.aircraft);
  } else {
    messages.push(detail.reason.status === 404 ? "Aircraft left the live region." : "Route details unavailable.");
  }
  if (history.status === "fulfilled") {
    state.historyById.set(id, history.value.points);
  } else {
    messages.push("Position history unavailable.");
  }
  detailStatus.textContent = messages.join(" ");
  fillDetail(currentAircraftById(id));
  renderMap();
}

function selectFlight(id) {
  state.selectedId = id;
  detailPanel.hidden = false;
  setPanel(true);
  renderSelection();
  fillDetail(currentAircraftById(id));
  rowById.get(id)?.scrollIntoView({ block: "nearest" });

  if (state.mode === "live" && liveAircraftById(id)) {
    loadSelectedAircraft(id).catch((error) => {
      if (error.name !== "AbortError") detailStatus.textContent = error.message;
    });
  } else {
    detailStatus.textContent = "Showing recorded replay data.";
  }
}

function closeDetail() {
  state.detailRequest?.abort();
  state.selectedId = null;
  detailPanel.hidden = true;
  detailStatus.textContent = "";
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
}

function renderStatus() {
  if (state.mode === "replay") {
    const frame = state.replayFrames[state.replayIndex];
    statusText.textContent = frame
      ? `REPLAY · ${formatClock(frame.timestamp).toUpperCase()} · ${state.speed}×`
      : "REPLAY · NO RECORDED DATA";
    statusPill.dataset.state = "replay";
    return;
  }

  if (state.lastError && !state.aircraft.length) {
    statusText.textContent = "LIVE · API UNAVAILABLE";
    statusPill.dataset.state = "stale";
  } else if (state.meta.status === "starting") {
    statusText.textContent = "LIVE · CONNECTING";
    statusPill.dataset.state = "stale";
  } else if (state.meta.status === "degraded" || state.lastError) {
    statusText.textContent = `⚠ DATA STALE · ${formatAge(state.meta.updateAgeSeconds).toUpperCase()}`;
    statusPill.dataset.state = "stale";
  } else {
    statusText.textContent = `LIVE · ${formatAge(state.meta.updateAgeSeconds).toUpperCase()}`;
    statusPill.dataset.state = "live";
  }
}

function renderPeriodText() {
  if (state.mode === "live") {
    periodText.textContent = `LIVE FEED · ${state.aircraft.length} AIRCRAFT · ${formatAge(state.meta.updateAgeSeconds).toUpperCase()}`;
    return;
  }
  if (state.replayLoading) {
    periodText.textContent = "LOADING RECENT REPLAY…";
    return;
  }
  const frame = state.replayFrames[state.replayIndex];
  periodText.textContent = frame
    ? `FRAME ${state.replayIndex + 1} OF ${state.replayFrames.length} · ${formatClock(frame.timestamp).toUpperCase()}${state.replayTruncated ? " · LIMITED" : ""}`
    : "NO RECORDED POSITIONS IN THE LAST HOUR";
}

function updateReplayControls() {
  const enabled = state.mode === "replay" && state.replayFrames.length > 0 && !state.replayLoading;
  $$(".replay__controls button, .replay__controls select, #replay-scrubber")
    .forEach((control) => { control.disabled = !enabled; });
  replayBar.dataset.mode = state.mode;
  $("#mode-replay").setAttribute("aria-pressed", String(state.mode === "replay"));
  $("#mode-live").setAttribute("aria-pressed", String(state.mode === "live"));
  scrubber.min = 0;
  scrubber.max = Math.max(0, state.replayFrames.length - 1);
  scrubber.value = state.replayIndex;
}

function renderAlert() {
  const activeIds = new Set(currentAircraft().filter((item) => item.emergency).map((item) => item.id));
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
  renderFilters();
  buildFlightList();
  buildMap();
  renderMap();
  renderFlights();
  renderSelection();
  renderAlert();
  renderStatus();
  renderPeriodText();
  updateReplayControls();
  if (state.selectedId) fillDetail(currentAircraftById(state.selectedId));
}

function showLoadError(error) {
  $("#load-error-text").textContent = error.message;
  $("#load-error").hidden = false;
}

function clearLoadError() {
  $("#load-error").hidden = true;
  $("#load-error-text").textContent = "";
}

function scheduleLiveRefresh() {
  clearTimeout(state.liveTimerId);
  const seconds = Math.max(5, Number(state.meta.refreshIntervalSeconds) || 30);
  state.liveTimerId = setTimeout(() => refreshLive(), seconds * 1000);
}

function applyLiveSnapshot(payload) {
  state.meta = payload.meta || {};
  state.aircraft = Array.isArray(payload.aircraft) ? payload.aircraft : [];
  state.airports = collectAirports(state.aircraft, state.meta.region);
  state.lastError = null;
  clearLoadError();
  if (state.selectedId && !liveAircraftById(state.selectedId) && state.mode === "live") closeDetail();
  if (state.mode === "live") renderCurrent();
  else renderStatus();
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
  try {
    applyLiveSnapshot(await requestJson("/api/aircraft", { signal: controller.signal }));
  } catch (error) {
    if (error.name === "AbortError") return;
    if (error instanceof ApiError && error.status === 503 && error.payload) {
      applyLiveSnapshot(error.payload);
    } else {
      state.lastError = error;
      if (!state.aircraft.length) showLoadError(error);
      renderStatus();
      renderPeriodText();
    }
  } finally {
    if (!controller.signal.aborted) scheduleLiveRefresh();
  }
}

function populateReplayDate() {
  const dates = [...new Set(state.replayFrames.map((frame) => new Date(frame.timestamp).toLocaleDateString()))];
  replayDate.innerHTML = dates.length
    ? dates.map((date) => `<option>${esc(date)}</option>`).join("")
    : "<option>No data</option>";
}

async function loadReplay() {
  state.replayRequest?.abort();
  const controller = new AbortController();
  state.replayRequest = controller;
  state.replayLoading = true;
  renderPeriodText();
  updateReplayControls();
  try {
    const payload = await requestJson(`/api/replay?${buildTimeWindow(ONE_HOUR_MS)}`, {
      signal: controller.signal,
    });
    state.replayFrames = payload.frames || [];
    state.replayTruncated = Boolean(payload.truncated);
    state.replayIndex = Math.max(0, state.replayFrames.length - 1);
    populateReplayDate();
    clearLoadError();
  } catch (error) {
    if (error.name === "AbortError") return;
    state.replayFrames = [];
    state.replayIndex = 0;
    showLoadError(error);
  } finally {
    if (!controller.signal.aborted) {
      state.replayLoading = false;
      renderCurrent();
    }
  }
}

async function setMode(mode) {
  setPlaying(false);
  state.mode = mode;
  if (mode === "replay" && !state.replayFrames.length) {
    renderCurrent();
    await loadReplay();
    return;
  }
  renderCurrent();
  if (state.selectedId && mode === "live") selectFlight(state.selectedId);
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
  if (playing && state.replayIndex >= state.replayFrames.length - 1) state.replayIndex = 0;
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
  if (state.playing && state.replayIndex >= state.replayFrames.length - 1) setPlaying(false);
}

function goToReplayFrame(index) {
  showReplayFrame(index);
  scheduleNextFrame();
}

function setSpeed(speed) {
  state.speed = speed;
  $$('[data-speed]').forEach((button) => {
    button.setAttribute("aria-pressed", String(Number(button.dataset.speed) === speed));
  });
  renderStatus();
  scheduleNextFrame();
}

function wireEvents() {
  flightList.addEventListener("click", (event) => {
    const row = event.target.closest(".flight-row");
    if (row) selectFlight(row.dataset.id);
  });
  mapLayer.addEventListener("click", (event) => {
    const marker = event.target.closest(".marker");
    if (marker) selectFlight(marker.dataset.id);
  });
  $("#detail-close").addEventListener("click", closeDetail);
  $("#tab-details").addEventListener("click", () => setTab("details"));
  $("#tab-chart").addEventListener("click", () => setTab("chart"));
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
  $("#replay-play").addEventListener("click", () => setPlaying(!state.playing));
  $("#replay-back").addEventListener("click", () => goToReplayFrame(state.replayIndex - 1));
  $("#replay-forward").addEventListener("click", () => goToReplayFrame(state.replayIndex + 1));
  scrubber.addEventListener("input", () => goToReplayFrame(Number(scrubber.value)));
  $$('[data-speed]').forEach((button) => {
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

  window.addEventListener("resize", renderMap);
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

async function start() {
  wireEvents();
  setPanel(true);
  updateReplayControls();
  await refreshLive({ immediate: true });
}

start();
