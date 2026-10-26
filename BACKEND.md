# Flight Tracker Backend

The backend polls ADSB.lol every 30 seconds, normalizes provider fields, derives flight progress and ETA, observes departure transitions, and stores a rolling 24-hour position history in SQLite. The default data path uses ADSB.lol plus ADSBDB route fallback; both are free and require no API key.

## Run it

Requirements: Node.js 20 or newer.

```sh
npm install
cp .env.example .env
npm start
```

Open <http://localhost:3000>. Express serves the frontend and same-origin API.

## Provider behavior

ADSB.lol supplies positions, callsigns, registrations, movement data, emergency fields, and best-effort route waypoints. `ADSBLOL_API_TOKEN` is blank because the provider currently does not require one; the setting is retained for future authentication.

When ADSB.lol's batch route endpoint returns no route, ADSBDB supplies origin and destination airport coordinates by callsign. The backend rejects a result when the aircraft's current position is geographically implausible for that route, which protects against stale or reused callsigns. Lookups run only for uncached callsigns, use a maximum of four concurrent requests by default, and are cached for six hours. A failure in one route service does not stop live position collection, and unknown or implausible callsigns remain explicitly unavailable rather than receiving invented routes.

AirLabs remains optional. With a blank `AIRLABS_API_KEY`, selected-flight requests do not make enrichment calls and all core requirements continue to work using derived values.

Never place provider credentials in frontend code or commit `.env`.

## Derived fields

| Field | Meaning |
|---|---|
| `progressPercent` | Percentage of origin-to-destination distance already covered |
| `remainingDistanceNm` | Great-circle distance from current position to destination |
| `eta` | Arrival estimate based on remaining distance and five recent valid speeds |
| `etaSource` | `calculated`, or an optional enrichment provider when configured |
| `firstObservedAt` | First time this server session observed the flight |
| `departureTime` | Observed takeoff time, or first observation when already airborne |
| `departureTimeSource` | `observed` for a ground-to-air transition; `first-observed` otherwise |

Calculated ETA is intentionally identified as an estimate; it does not account for winds, holding, routing changes, or terminal operations.

## Frontend-facing endpoints

| Endpoint | Frontend use |
|---|---|
| `GET /api/aircraft` | Current aircraft, derived fields, map, search, filters, and alerts |
| `GET /api/aircraft/:id` | Selected-flight details and optional schedule-provider override |
| `GET /api/aircraft/:id/history` | Position trail and altitude samples |
| `GET /api/replay?from=...&to=...` | Recent replay frames up to the retention period |
| `GET /api/health` | Feed health, last update, and enabled providers |

The health response identifies ADSB.lol as the live source, ADSBDB as the route fallback, and whether optional AirLabs enrichment is enabled.

Time ranges accept ISO-8601 values or millisecond timestamps. Replay responses are limited to 50,000 rows.

## Replay persistence

Each successful provider snapshot is stored in SQLite. Schema migration adds new derived fields to existing databases without deleting prior history. The default database is `backend/data/flight-tracker.db`, and positions older than `HISTORY_RETENTION_HOURS` are removed after successful collections.

## Tests

```sh
npm test
```

The frontend consumes these endpoints through `js/api.js` and `js/app.js`; external provider calls remain server-side.
