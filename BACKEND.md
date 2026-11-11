# Flight Tracker Backend

The backend polls ADSB.lol every 30 seconds, normalizes provider fields, derives flight progress and ETA, observes departure transitions, and stores a rolling seven-day position history in SQLite. The default data path uses ADSB.lol plus ADSBDB route fallback; both can run without a committed API secret.

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

When ADSB.lol's batch route endpoint returns no route, ADSBDB supplies origin and destination airport coordinates by callsign. The backend rejects a result when the aircraft's current position is geographically implausible for that route, which protects against stale or reused callsigns. Lookups run only for uncached callsigns, use a maximum of four concurrent requests by default, and are cached for six hours in memory and SQLite. A route-service failure is negatively cached for five minutes. A failure in one route service does not stop live position collection, and unknown or implausible callsigns remain explicitly unavailable rather than receiving invented routes.

Position collection honors a provider's `Retry-After` response and otherwise uses exponential backoff up to 15 minutes, with jitter. Successful collection immediately restores the normal 30-second interval.

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
| `flightSessionId` | Aircraft id, callsign and session start combined into a replay-safe flight identity |

Calculated ETA is intentionally identified as an estimate; it does not account for winds, holding, routing changes, or terminal operations.

## Frontend-facing endpoints

| Endpoint | Frontend use |
|---|---|
| `GET /api/aircraft` | Current aircraft, derived fields, map, search, filters, and alerts |
| `GET /api/aircraft/:id` | Selected-flight details and optional schedule-provider override |
| `GET /api/aircraft/:id/history` | Position trail and altitude samples |
| `GET /api/replay?from=...&to=...` | Raw recent replay frames, limited to a 24-hour request |
| `GET /api/replay?date=YYYY-MM-DD` | One UTC day, downsampled to 15-minute frames unless `intervalSeconds` is supplied |
| `GET /api/replay/dates` | UTC dates currently available in SQLite |
| `GET /api/health` | Feed health, last update, and enabled providers |

The health response identifies ADSB.lol as the live source, ADSBDB as the route fallback, and whether optional AirLabs enrichment is enabled.

Time ranges accept ISO-8601 values or millisecond timestamps. Replay responses are limited to 50,000 rows. `intervalSeconds` accepts 30 through 3,600 seconds. Date replay responses also contain the historical airports used by those flights and the list of available replay dates.

## Replay persistence

Each successful provider snapshot is stored in SQLite. Schema migration adds new derived fields, airport metadata, and persistent route caching without deleting prior history. The default database is `backend/data/flight-tracker.db`, and positions older than `HISTORY_RETENTION_HOURS` are removed after successful collections. Seven days at 30-second collection is retained locally; date queries select one complete recorded snapshot per time bucket so the browser does not download every raw row.

Increasing retention does not create more provider calls. One server makes about 2,880 ADSB.lol position requests per continuously running day regardless of the number of connected browsers. Separate backend processes do multiply that number, so a single shared backend is recommended for the internship classroom. AirLabs remains capped locally by `AIRLABS_DAILY_REQUEST_LIMIT` and is disabled when its key is blank.

## Tests

```sh
npm test
```

The frontend consumes these endpoints through `js/api.js` and `js/app.js`; external provider calls remain server-side.
