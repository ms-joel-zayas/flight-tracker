# Flight Tracker — Week 10 Student Starter

Welcome to Week 10 of the MatrixSpace and Uxbridge High School internship.

This branch, `v5-uxbridge`, is your working branch. Your Week 9 Leaflet map is
now connected to a mentor-prepared backend, but three small frontend data
functions are left for you to complete in `js/app.js`. The finished reference
lives on `v5-final`. Use it when you are stuck, not as code to copy all at once.

## This week's goal

Make the data path reliable:

1. Load the available replay dates.
2. Load recorded aircraft for one date.
3. Show loading, success, no-data, and error states.
4. Connect the same interface to live aircraft.

The important idea is that both replay and live data reach the map through our
own `/api` routes. The frontend does not need to know which outside flight-data
provider answered.

```text
Your frontend
    |
    | requestJson("/api/aircraft")
    v
Mentor-owned backend
    |
    +-- ADSB.fi or ADSB.lol for live positions
    +-- ADSBDB for aircraft and route details
    +-- optional AirLabs schedule details
    +-- SQLite for recorded replay
```

## What you will and will not change

| Path | Your responsibility |
|---|---|
| `js/app.js` | Complete the three `WEEK 10 TODO` sections |
| `index.html` | Optional wording or accessibility improvements |
| `css/styles.css` | Optional presentation improvements |
| `js/api.js` | Mentor-prepared; read and use it, but do not replace it |
| `backend/` | Mentor-owned; do not implement provider or database logic |
| `.env` | Mentor-owned configuration; never commit it |

You are not responsible for CORS, authentication, API keys, provider outages,
caching, rate limits, or SQLite. Those concerns are already handled behind the
stable frontend API.

## Run the project

You need Node.js 20 or newer. From the project folder:

```sh
npm install
cp .env.example .env
npm start
```

Open <http://localhost:3000>. Express serves both the page and the API, so do
not start Live Server or a second Python server for this branch.

The backend begins recording nearby aircraft as soon as it starts. Replay may
have only one frame at first; leave it running while you work and more recorded
positions will appear.

## The stable aircraft shape

Live aircraft and replay aircraft use the same field names:

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

Some fields can be `null`. That is normal live-data behavior. Display
**Not available** or **Route not published** rather than inventing a value.

## Complete the challenge

Open `js/app.js` and search for `WEEK 10 TODO`. Work in this order.

### Step 1 — Load replay dates

Complete `loadReplayDates()`.

- Request `/api/replay/dates` with `requestJson()`.
- Store the returned `dates` array in `state.replayDates`.
- Always call `populateReplayDates()` and `updateReplayControls()`.
- If the request fails, keep an empty array and log a useful warning.

Check the browser's Network tab. A successful request returns JSON similar to:

```json
{ "dates": ["2026-11-11"] }
```

### Step 2 — Load one replay

Complete the middle of `loadReplay()`.

- Treat a missing date as a valid no-data state.
- Request `/api/replay?date=YYYY-MM-DD`.
- Put `payload.frames` into `state.replayFrames`.
- Convert `payload.airports` with `normalizeReplayAirports()`.
- Reset `state.replayIndex` to `0`.
- Clear an old error after a successful request.
- On failure, clear the replay state and call `showLoadError()`.

The surrounding code already starts and ends the loading state. It also
disables controls while a request is running and ignores a canceled request.

### Step 3 — Connect live data

Complete the `try` and `catch` portions of `refreshLive()`.

- Request `/api/aircraft` with `requestJson()`.
- Pass a successful response to `applyLiveSnapshot()`.
- A `503` response can still include the backend's last good snapshot. Use it.
- For other failures, remember the error, show the load error if no aircraft
  have ever loaded, and update the status text.
- Let the provided `finally` block schedule the next refresh.

Do not fetch ADSB.fi, ADSB.lol, ADSBDB, or AirLabs from the browser.

## Required states

Use the page and browser developer tools to confirm all four states:

| State | What the page should communicate |
|---|---|
| Loading | A request is currently in progress |
| Success | Aircraft or replay frames arrived |
| No data | The request worked, but its array is empty |
| Error/stale | The request failed, or the last update is too old |

To observe an error after the page has loaded, use the Network tab's **Offline**
setting briefly, wait for a refresh, and then return it to **No throttling**.
The last good aircraft should remain visible while the status reports a
problem.

## Check your work

Run the existing project checks:

```sh
npm test
```

Then check the application manually:

- Live aircraft appear on the Leaflet map.
- Search and origin/destination filters still work.
- Selecting a list row or marker opens the same aircraft details.
- Replay mode loads dates and recorded frames.
- Replay play, step, scrubber, and speed controls work.
- No-data and error states explain what happened instead of showing a blank
  page.
- Returning to live mode resumes the current live snapshot.

## Compare with `v5-final`

First save and commit your own work. Then compare only the file you need:

```sh
git fetch origin
git diff v5-uxbridge origin/v5-final -- js/app.js
```

To view the finished function without changing branches:

```sh
git show origin/v5-final:js/app.js
```

The final branch is a mentor reference. Stay on `v5-uxbridge` for your work.

## Save your work

Commit small, working steps:

```sh
git status
git add js/app.js
git commit -m "Load replay dates"
git push
```

Repeat with a short message after each completed step.

## Frontend API reference

| Request | What it returns |
|---|---|
| `GET /api/aircraft` | Current normalized aircraft and feed status |
| `GET /api/aircraft/:id` | Extra details for one selected aircraft |
| `GET /api/aircraft/:id/history` | Recent trail and altitude points |
| `GET /api/replay/dates` | UTC dates with recorded data |
| `GET /api/replay?date=YYYY-MM-DD` | Recorded frames for one day |

Not every aircraft has a published origin or destination. Small private
aircraft may not have a public flight plan, and callsigns can be missing or
reused. Missing route information is not a frontend bug.
