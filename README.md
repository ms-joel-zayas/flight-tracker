# Flight Tracker

A black-and-white flight tracker built with HTML, CSS, vanilla JavaScript, Express, and SQLite. ADSB.lol supplies free live aircraft data, while route lookup prefers ADSB.lol and automatically falls back to the free, no-key ADSBDB API. The backend derives progress, departure observations, and ETA without requiring a schedule provider.

## Run it

Requirements: Node.js 20 or newer.

```sh
npm install
cp .env.example .env
npm start
```

Open <http://localhost:3000>. Do not open `index.html` directly or use a separate static server unless its origin is listed in `CORS_ORIGINS`.

No API key is required for the default data path. With an empty `AIRLABS_API_KEY`, the backend calculates ETA from remaining great-circle distance and the five most recent valid ground-speed samples. It reports `Departed` only after observing a ground-to-air transition; otherwise an airborne aircraft is labeled `First observed`. AirLabs remains an optional override if access becomes available later.

ADSB.lol route results are used when available. Missing or empty route results are resolved by ADSBDB per callsign with at most four concurrent requests, geographically checked against the aircraft's current position, then cached for six hours. Implausible or unknown routes remain unavailable instead of producing a misleading ETA. General aviation, private, and unusual callsigns may still have no published route.

## Browser data flow

| API | Browser behavior |
|---|---|
| `GET /api/aircraft` | Loads and polls live aircraft, derived flight data, status, map markers, filters, and emergencies |
| `GET /api/aircraft/:id` | Loads normalized selected-aircraft details and optional schedule-provider enrichment |
| `GET /api/aircraft/:id/history` | Draws the selected aircraft trail and altitude chart |
| `GET /api/replay?from=...&to=...` | Loads the most recent hour into the replay controls |
| `GET /api/health` | Provides diagnostics; the UI normally uses metadata included with `/api/aircraft` |

The frontend uses only normalized fields such as `latitude`, `longitude`, `altitudeFeet`, `speedKnots`, and `tailNumber`. It never calls ADSB.lol or an optional schedule provider directly.

## Derived flight data

- `progressPercent` compares remaining great-circle distance with the origin-to-destination route distance.
- `remainingDistanceNm` is the great-circle distance from the current position to the destination airport.
- `eta` uses remaining distance and an average of the five most recent airborne speeds. `etaSource: "calculated"` distinguishes it from a published airline ETA.
- `departureTimeSource: "observed"` means the running server saw a ground-to-air transition.
- `departureTimeSource: "first-observed"` means the aircraft was already airborne when tracking began. The UI labels this honestly as `First observed`.

These values are included in live snapshots and stored with every SQLite replay position.

## Frontend behavior

- Live mode refreshes at `meta.refreshIntervalSeconds`, pauses polling work while the page is hidden, and keeps the last good snapshot visible during temporary failures.
- The status pill reflects `live`, `starting`, and `degraded` backend states.
- Search matches flight number, callsign, tail number, and aircraft ID. Airport filters are derived from resolved routes.
- Selecting an aircraft loads normalized details and one hour of history. Slow responses are cancelled when another aircraft is selected.
- `ETA · CALCULATED`, `Departed`, and `First observed` communicate the provenance of displayed times.
- The altitude tab graphs real history when at least two altitude samples exist.
- Emergency broadcasts and standard emergency squawks drive marker, row, and banner alerts.
- Replay loads recorded SQLite frames for the last hour and supports 1×, 2×, 5×, and 10× speeds.

## Map projection

The map remains a lightweight SVG wireframe. `js/api.js` projects latitude/longitude into its 0–100 coordinate space using the tracking center and radius returned by the backend. Route airports inside the region are shown directly; projected paths toward destinations outside the region stop at the map edge.

## Configuration

| Setting | Default | Purpose |
|---|---:|---|
| `PORT` | `3000` | Express and frontend port |
| `TRACKING_LAT`, `TRACKING_LON` | Uxbridge, MA | Tracking region center |
| `TRACKING_RADIUS_NM` | `25` | ADSB.lol radius and frontend map bounds |
| `POLL_INTERVAL_MS` | `30000` | Backend provider polling interval |
| `STALE_AFTER_SECONDS` | `60` | Age at which the feed is degraded |
| `HISTORY_RETENTION_HOURS` | `24` | SQLite position retention |
| `ADSBDB_BASE_URL` | `https://api.adsbdb.com` | Free route fallback service |
| `ADSBDB_MAX_CONCURRENCY` | `4` | Maximum simultaneous fallback lookups on a cache miss |
| `AIRLABS_API_KEY` | empty | Optional schedule-provider override; not required for ETA or progress |

Never put provider credentials in frontend files or commit `.env`.

## Project layout

```text
backend/
  aircraft.js            Normalization and derived flight calculations
  app.js                 Express routes and static frontend
  collector.js           Provider polling, route caching, and flight sessions
  database.js            SQLite history, migrations, and provider usage
  providers/             ADSB.lol, ADSBDB fallback, and optional AirLabs clients
css/styles.css            Wireframe styles
js/api.js                 Browser API client and map/data helpers
js/app.js                 UI state, rendering, polling, selection, and replay
test/                     Backend and frontend-helper tests
index.html                Frontend structure
data.json                 Legacy demo fixture; no longer used at runtime
```

## Tests

```sh
npm test
```

Tests cover provider normalization, derived ETA/progress, departure transitions, SQLite migration and persistence, API routes, and frontend projection helpers.

## Current limitations

- The map is a projected wireframe rather than a tiled geographic map.
- Origin, destination, progress, and ETA depend on ADSB.lol or ADSBDB resolving route waypoints.
- Calculated ETA does not account for winds, routing changes, holding, or approach delays.
- Departure observation state starts with the server process; restarting midflight produces `First observed`, not an invented departure time.
- Replay currently requests the most recent hour even though SQLite retains 24 hours by default.
