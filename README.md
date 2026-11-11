# Flight Tracker

Flight Tracker is a MatrixSpace and Uxbridge High School internship project. The v5 application combines the v4-final Leaflet interface with a lightweight Express and SQLite backend that supplies live ADSB.lol aircraft, route information, recorded history, and replay.

## Run it

Requirements: Node.js 20 or newer.

~~~sh
npm install
cp .env.example .env
npm start
~~~

Open http://localhost:3000. Express serves both the frontend and API, so a separate static server is not needed.

No API key is required for the default data path. ADSB.lol supplies live aircraft and route data, with ADSBDB as a free route fallback. AirLabs is optional; leave AIRLABS_API_KEY blank unless a key is available.

Never put provider credentials in frontend files or commit .env.

## What the application does

- Displays live aircraft on a real Leaflet map using latitude and longitude.
- Polls the local backend at meta.refreshIntervalSeconds (30 seconds by default).
- Searches by flight number, callsign, tail number, or aircraft ID.
- Filters by known origin and destination airports.
- Shows selected-aircraft details, route progress, derived ETA, trail, and altitude history.
- Displays emergency broadcasts and standard emergency squawks.
- Replays retained SQLite snapshots by UTC date at 1×, 2×, 5×, or 10×.
- Keeps OpenStreetMap attribution visible and continues drawing aircraft if tiles fail.

The sample data.json, data-quality helpers, and mentor documents from v4-final remain in the repository as educational fixtures. The running application gets aircraft and replay data from the backend API instead of data.json.

## Browser data flow

| API | Browser behavior |
|---|---|
| GET /api/aircraft | Loads and polls normalized live aircraft, feed status, routes, and emergencies |
| GET /api/aircraft/:id | Loads selected-aircraft details and optional AirLabs enrichment |
| GET /api/aircraft/:id/history | Draws the selected aircraft trail and altitude chart |
| GET /api/replay/dates | Lists UTC dates currently retained in SQLite |
| GET /api/replay?date=YYYY-MM-DD | Loads one day of downsampled replay frames and historical airports |
| GET /api/health | Reports feed status, providers, and replay configuration |

The browser never contacts ADSB.lol, ADSBDB, or AirLabs directly. Multiple browser clients share the backend collector and do not multiply upstream position requests.

## Data model

The frontend consumes normalized fields such as latitude, longitude, altitudeFeet, speedKnots, headingDegrees, flightNumber, callsign, tailNumber, origin, destination, progressPercent, departureTime, and eta.

flightSessionId distinguishes a particular callsign session from the physical aircraft's Mode-S id. Live detail and history requests use the Mode-S ID; replay markers use the session ID when available so separate flights are not joined into one trail.

### Derived flight data

- progressPercent compares remaining great-circle distance with the origin-to-destination distance.
- remainingDistanceNm is the great-circle distance from the aircraft to the destination.
- A calculated ETA uses remaining distance and the five most recent valid airborne speed samples.
- departureTimeSource identifies an observed departure or a flight first seen airborne.
- Unknown or geographically implausible routes remain unavailable instead of receiving invented values.

## Replay and retention

Each successful provider snapshot is stored in SQLite. By default:

- History is retained for seven days.
- A replay request covers at most 24 hours.
- Date replay returns one complete snapshot per 15-minute bucket, or approximately 96 frames per day.
- Replay reads SQLite and does not create additional provider requests.

The replay date selector uses /api/replay/dates; the timeline uses the selected date's frames and historical airport coordinates.

## Configuration

| Setting | Default | Purpose |
|---|---:|---|
| PORT | 3000 | Express and frontend port |
| TRACKING_LAT, TRACKING_LON | Uxbridge, MA | Tracking region center |
| TRACKING_RADIUS_NM | 25 | ADSB.lol radius and initial Leaflet bounds |
| POLL_INTERVAL_MS | 30000 | Backend provider polling interval |
| STALE_AFTER_SECONDS | 60 | Age at which the feed becomes degraded |
| HISTORY_RETENTION_HOURS | 168 | SQLite history retention |
| REPLAY_MAX_RANGE_HOURS | 24 | Maximum range of one replay request |
| REPLAY_STEP_SECONDS | 900 | Default date-replay bucket size |
| ADSBDB_MAX_CONCURRENCY | 4 | Maximum simultaneous fallback route lookups |
| AIRLABS_API_KEY | empty | Optional schedule-provider key |

The collector normally makes one ADSB.lol position request every 30 seconds, about 2,880 per continuously running day. It honors Retry-After and applies exponential backoff after failures. For a classroom deployment, prefer one shared backend instead of one continuously running backend per student.

ADSB.lol data is published under ODbL 1.0. OpenStreetMap tiles require attribution and are suitable for this lightweight internship project, not heavy production traffic.

See BACKEND.md for backend implementation details and docs/ for the v4 mentor references.

## Project layout

~~~text
backend/                  Express, providers, SQLite, normalization
css/styles.css            Leaflet wireframe styles
js/api.js                 Browser API client and formatting helpers
js/app.js                 Leaflet UI, polling, history, and replay
js/quality.js             v4 educational data-quality helpers
test/                     Node backend and API tests
tests/                    Jest data-quality lesson tests
data.json                 v4 fixture; not used at runtime
~~~

## Tests

~~~sh
npm test
~~~

npm test runs both suites:

- npm run test:backend — Node tests for providers, normalization, backoff, SQLite, API routes, replay, and browser helpers.
- npm run test:frontend — Jest tests for the v4 data-quality exercises.

## Current limitations

- Origin, destination, progress, and ETA depend on a provider resolving plausible route waypoints.
- Calculated ETA does not account for wind, routing changes, holding, or approach delays.
- Departure observation state starts with the server process; restarting midflight produces First observed, not an invented departure time.
- OpenStreetMap's public tile service requires an internet connection and is not intended for heavy use.
