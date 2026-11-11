# Flight Tracker — Week 10

This is the MatrixSpace and Uxbridge High School internship flight tracker.

> This branch contains the mentor-prepared live-data integration. Students should do the Week 10 challenge in their assigned student branch and use this branch as a reference, not as an answer key to copy.

Week 10 connects the same frontend to two kinds of data:

- **Live:** the browser asks our backend for the latest nearby aircraft.
- **Replay:** the browser asks the same backend for positions already recorded in SQLite.

The frontend does not need to know which outside flight-data service answered. CORS, provider authentication, timeouts, retries, caching, and outages belong to the mentor-owned backend.

## Run it

Requirements: Node.js 20 or newer.

```sh
npm install
cp .env.example .env
npm start
```

Open <http://localhost:3000>.

Express serves both the page and `/api`, so do not start a second frontend server. No API key is needed for the default path.

## Week 10 objective

Make the replay path reliable first, then use the mentor-provided live adapter through the same UI.

The page should clearly show:

1. **Loading** — a request is in progress.
2. **Success** — live aircraft or replay frames arrived.
3. **No data** — the request worked, but there is nothing to show.
4. **Error or stale data** — the request failed, or the last good update is too old.

Students are not responsible for solving external API authentication, CORS, proxying, rate limits, or provider outages.

## Student work and mentor-owned code

| Path | Who works here? | Purpose |
|---|---|---|
| `index.html` | Students | Page structure and accessible labels |
| `css/styles.css` | Students | Visual design and responsive layout |
| `js/app.js` | Students | UI state, loading/error messages, map, selection, and replay controls |
| `js/api.js` | Mentor-prepared; students may read it | Small, stable browser request and formatting helpers |
| `backend/` | Mentors | Providers, normalization, retry logic, enrichment, SQLite, and API routes |
| `.env` / `.env.example` | Mentors | Server-only configuration and optional secrets |
| `test/` | Mentors | Backend and API contract tests |
| `data.json`, `js/quality.js`, `tests/` | Earlier-week reference | Week 8/9 data-quality fixtures; not used by the live page at runtime |

Never put provider URLs or API keys in `index.html`, `css/`, or `js/`.

## Request and response flow

```text
Student frontend
    |
    | fetch("/api/aircraft")
    v
Mentor-owned Express API
    |
    +-- live positions: ADSB.fi, with ADSB.lol fallback
    +-- aircraft and route details: ADSBDB
    +-- optional schedule details: AirLabs
    +-- recorded replay: SQLite
```

The important idea is the stable middle line: the frontend always calls our API. A provider can fail or be replaced without requiring students to rewrite the interface.

## Frontend API

| Request | What the frontend receives |
|---|---|
| `GET /api/aircraft` | Current normalized aircraft, update status, and the tracking region |
| `GET /api/aircraft/:id` | Extra details for one selected aircraft |
| `GET /api/aircraft/:id/history` | Recent points for its trail and altitude chart |
| `GET /api/replay/dates` | UTC dates that have recorded data |
| `GET /api/replay?date=YYYY-MM-DD` | Downsampled replay frames for one day |
| `GET /api/health` | Feed and provider status for mentors |

The live list and replay frames use the same field names, including:

```js
{
  id,
  callsign,
  flightNumber,
  tailNumber,
  latitude,
  longitude,
  altitudeFeet,
  speedKnots,
  headingDegrees,
  origin,
  destination
}
```

Some values can be `null`. The UI should say **Not available** or **Route not published** instead of inventing information.

## Aircraft popup and detail panel

ADSB.fi usually supplies the live position, callsign, registration, aircraft type code, altitude, speed, heading, vertical rate, and squawk. When an aircraft is selected, the backend makes one cached ADSBDB lookup to add the full aircraft model, manufacturer, registered owner or airline operator, and a plausible route when published.

AirLabs is optional. If a mentor configures a key, it can add scheduled departure and arrival information. The core app still works when AirLabs is disabled.

Not every aircraft will have an origin and destination:

- Small private aircraft often do not publish a flight plan.
- A callsign can be missing, reused, or temporarily incorrect.
- A route result is hidden when the current aircraft position makes that route implausible.
- An outside data source can be unavailable.

That is normal live-data behavior and is a useful Week 10 lesson: a successful response can still contain incomplete fields.

## How `js/app.js` is organized

The numbered sections follow the pattern used by the earlier `*-final` branches:

1. Grab the page pieces and shared constants.
2. Keep UI state in one `state` object.
3. Read normalized live or replay records through small helpers.
4. Build and update the flight list and Leaflet map.
5. Load one selected aircraft and its history.
6. Show loading, success, stale, and error states.
7. Control replay dates, frames, playback, and speed.
8. Connect clicks and keyboard input to update functions.
9. Start the application.

Leaflet still receives `[latitude, longitude]`. Markers, trails, and projected routes are rebuilt from the current state. Selecting a marker opens the same details as selecting its list row.

## What the application currently does

- Polls our backend every 30 seconds by default.
- Searches by flight number, callsign, tail number, or aircraft ID.
- Filters by known origin and destination airports.
- Shows enriched aircraft identity and live movement in the popup and detail panel.
- Draws a selected aircraft trail and altitude history.
- Displays emergency broadcasts and emergency squawk codes.
- Replays retained snapshots by UTC date at 1×, 2×, 5×, or 10×.
- Keeps the last good snapshot visible when a provider temporarily fails.

## Project layout

```text
flight-tracker/
  index.html                 page structure
  css/styles.css             numbered visual sections
  js/app.js                  student-facing UI behavior
  js/api.js                  browser API and formatting helpers
  backend/                   mentor-owned server implementation
    app.js                   our stable HTTP routes
    collector.js             30-second live collection and retry behavior
    aircraft-enricher.js     selected-aircraft details
    providers/               outside provider adapters
    database.js              SQLite history and replay
  test/                      backend/API contract tests
  docs/                      earlier mentor references
  BACKEND.md                 backend operations and provider details
```

## Tests

```sh
npm test
```

- `npm run test:backend` checks normalization, providers, fallback behavior, caching, SQLite, replay, and our API contract.
- `npm run test:frontend` runs the earlier Week 8/9 data-quality answer-key tests.

See [BACKEND.md](BACKEND.md) for configuration, usage limits, retention, and backend implementation details.

## Not included on purpose

Students do not build a provider proxy, manage API credentials, repair an outside service, or guarantee that every aircraft has a route. Direct browser-to-provider integration remains a stretch topic, not a Week 10 requirement.
