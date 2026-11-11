# Flight Tracker Backend

The backend polls ADSB.fi every 30 seconds, normalizes provider fields, derives flight progress and ETA, observes departure transitions, and stores a rolling seven-day position history in SQLite. ADSB.lol is the automatic position fallback. ADSBDB supplies route data plus selected-aircraft identity such as manufacturer and model. All three can run without a committed API secret.

## Run it

Requirements: Node.js 20 or newer.

```sh
npm install
cp .env.example .env
npm start
```

Open <http://localhost:3000>. Express serves the frontend and same-origin API.

## Provider behavior

ADSB.fi supplies positions, callsigns, registrations, movement data, and emergency fields through its public no-key endpoint. `ADSB_POSITION_PROVIDER=adsbfi` makes it primary; setting the value to `adsblol` reverses the automatic fallback order. ADSB.fi's public endpoint is intended for personal and non-commercial use, has a published one-request-per-second limit, and requires attribution. The project's 30-second interval and visible map link meet those constraints for the internship deployment.

ADSB.lol supplies the same compatible aircraft fields and best-effort route waypoints. `ADSBLOL_API_TOKEN` is blank because the provider currently does not require one; the setting is retained for future authentication.

With the default ADSB.fi primary, ADSBDB supplies origin and destination airport coordinates by callsign directly, avoiding an unnecessary delay when ADSB.lol is unavailable. If ADSB.lol is configured as primary, its batch route endpoint is used first and ADSBDB resolves any missing routes. Route resolution runs in the background, so the initial live-position response and later polling never wait for optional route data. The backend rejects an ADSBDB result when the aircraft's current position is geographically implausible for that route, which protects against stale or reused callsigns. Lookups run only for uncached callsigns, use a maximum of four concurrent requests by default, and are cached for six hours in memory and SQLite. A route-service failure is negatively cached for five minutes. Unknown or implausible callsigns remain explicitly unavailable rather than receiving invented routes.

When a browser selects one aircraft, `/api/aircraft/:id` uses ADSBDB's combined aircraft-and-callsign endpoint. One request can add registration, ICAO type, manufacturer, model, registered owner, airline operator, and a plausible route. These selected-aircraft results, including no-match results, are cached in memory for six hours. Photos returned by ADSBDB are intentionally not exposed because the popup does not need a third-party image dependency. A failure leaves the original ADSB.fi record usable.

Position collection tries the configured primary source and then the secondary source. If both fail, it honors their `Retry-After` guidance and otherwise uses exponential backoff up to 15 minutes, with jitter. Successful collection immediately restores the normal 30-second interval. Snapshot metadata and each normalized aircraft identify the source that actually succeeded.

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
| `GET /api/aircraft/:id` | Cached ADSBDB identity/route details and optional AirLabs schedule override |
| `GET /api/aircraft/:id/history` | Position trail and altitude samples |
| `GET /api/replay?from=...&to=...` | Raw recent replay frames, limited to a 24-hour request |
| `GET /api/replay?date=YYYY-MM-DD` | One UTC day, downsampled to 15-minute frames unless `intervalSeconds` is supplied |
| `GET /api/replay/dates` | UTC dates currently available in SQLite |
| `GET /api/health` | Feed health, last update, and enabled providers |

The health response identifies ADSB.fi and ADSB.lol as position sources, ADSBDB's configured route role, and whether optional AirLabs enrichment is enabled. Live snapshot metadata reports the position source used for the most recent successful update.

Time ranges accept ISO-8601 values or millisecond timestamps. Replay responses are limited to 50,000 rows. `intervalSeconds` accepts 30 through 3,600 seconds. Date replay responses also contain the historical airports used by those flights and the list of available replay dates.

## Replay persistence

Each successful provider snapshot is stored in SQLite. Schema migration adds new derived fields, airport metadata, and persistent route caching without deleting prior history. The default database is `backend/data/flight-tracker.db`, and positions older than `HISTORY_RETENTION_HOURS` are removed after successful collections. Seven days at 30-second collection is retained locally; date queries select one complete recorded snapshot per time bucket so the browser does not download every raw row.

Increasing retention does not create more provider calls. One server makes about 2,880 primary-position requests per continuously running day regardless of the number of connected browsers; the fallback is called only after a primary failure. ADSBDB makes calls for new, uncached callsigns and at most one additional cached lookup when a user selects an aircraft. Separate backend processes do multiply these numbers, so a single shared backend is recommended for the internship classroom. AirLabs remains capped locally by `AIRLABS_DAILY_REQUEST_LIMIT` and is disabled when its key is blank.

## Tests

```sh
npm test
```

The frontend consumes these endpoints through `js/api.js` and `js/app.js`; external provider calls remain server-side.
