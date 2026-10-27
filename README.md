# Flight Tracker — MVP (Week 8: data from `data.json`)

> **Branch `v3-final` is the Week 8 reference for mentors.** Students work on their own `v3-uxbridge` branch, created from their final `v2-uxbridge` work, and compare with this branch. It is a reference, not an answer key to copy.

A black-and-white working version of the approved Flight Tracker design, built with only **HTML, CSS and JavaScript**. No build step, no libraries. As of Week 8 the flights, airports and map points live in **`data.json`** instead of being typed into the HTML, and a **replay** steps through up to five time periods, one every 5 seconds.

| Language | Job | File |
|---|---|---|
| HTML | Structure: what is on the screen | `index.html` |
| CSS | Presentation: how it looks (black-and-white wireframe) | `css/styles.css` |
| JavaScript | Behavior: loads the data, builds the page from it, reacts to clicks | `js/app.js` |
| JSON | Data: airports, flights and the map point of every flight in each period | `data.json` |
| JavaScript | Data-quality helpers: empty values, heading check, data summary | `js/quality.js` |

## Run it

The page loads `data.json` with `fetch()`, and browsers block `fetch()` for files opened by double-clicking (`file://`). Run a small local server instead:

- **VS Code:** right-click `index.html` and choose **Open with Live Server** (the Live Server extension is recommended in `.vscode/extensions.json`), or
- **Terminal:** run this in the project folder and open http://localhost:8000:

```
python3 -m http.server 8000
```

If you open the page by double-clicking, the app shows a "Could not load data.json" message that says the same thing.

## What you can do in the page

| Try this | What happens | Requirement |
|---|---|---|
| Click a flight in the list, or an aircraft on the map | Detail panel opens with departure, destination, progress bar and ETA; the selected flight's solid trail and dashed projected path appear | REQ-02, REQ-06, REQ-08 |
| Click the **Chart** tab in the detail panel | Placeholder box for the altitude-over-time chart | Week 6 placeholder (visualization) |
| Click **×** in the detail panel, or press Esc | Panel closes and the selection clears | REQ-08 |
| Click the **‹** handle between panel and map | Left panel slides away; click **›** to bring it back | REQ-08 |
| Type in **Search flights** (try `ACA2210`, `C-GKCB`, `ac 4471`); press Enter when one flight is left | List and map narrow to matches; Enter opens the flight | REQ-04 |
| Pick an **Origin** or **Dest** airport | List filters; non-matching aircraft are dimmed on the map; the count badge updates (try JFK, then BOS as dest to see the empty state) | REQ-05 |
| **Demo ▾ → Trigger emergency** | Alert banner appears; AC 3306 gets a solid marker with a pulsing outline. **View** opens that flight | REQ-09 |
| **Demo ▾ → Simulate stale data** | Status pill changes to a dashed "DATA STALE" state | REQ-03 |
| Click **REPLAY**, then **▶** | Replay starts at period 1. Every 5 seconds the next period appears: each aircraft jumps to a new point on its route toward its destination, its trail grows, and the detail panel updates. It stops after the last period; ▶ again restarts it | REQ-07 |
| In replay, use **◀◀ / ▶▶**, drag the **slider**, or pick **1× / 2× / 5× / 10×** | Step one period back or forward, jump to any period, or change the wait (5 s at 1×, 2.5 s at 2×, 0.5 s at 10×). The pill shows `REPLAY · OCT 02 · 12:15 · 2×` | REQ-07 |
| Click **● LIVE** | Replay stops. Live is **not functional yet**: the pill says `LIVE · NO FEED YET` and the map shows the last saved period. It will switch to a live API later | REQ-03, REQ-07 |

The **Demo** menu exists only because there is no live data yet. It stands in for events that a live feed will trigger later. Which flight gets the emergency is set in `data.json` (`meta.alertFlightId`).

## Empty values: `null`, missing, `0` and `""`

These are four different situations. The detail panel treats each one on purpose (helpers in `js/quality.js`, used by `setField()` in `js/app.js`):

| In the data | What it means | What the page shows | Console |
|---|---|---|---|
| `"altitude": null` | The key exists, but no value is known | Not available (gray italics) | quiet: expected |
| the key is not there | A missing field (JavaScript gives `undefined`) | Not available | warning: check for a typo |
| `"altitude": 0` | A real measurement that is zero | 0 ft | none |
| `"callsign": ""` | Text with nothing in it | Not available | warning: empty text |

On load the app also prints a short data-quality summary to the browser console (how many values are empty, any heading outside 0 to 359, flights whose ETA is before the last period). It reports; it never stops the app.

## Quality checks and the Challenge answer key

`node tests/quality.test.js` runs the reference answers for the Week 8 Challenge: the four empty-value cases, `isValidHeading()` (true only for numbers from 0 to 359) and the three findings counted from `data.json`. It prints PASS or FAIL for each. `docs/SAMPLE_DATA_DICTIONARY.md` is one possible Aircraft Data Dictionary. It marks the units of altitude, speed and heading as assumptions, because `data.json` does not state them.

## The data: `data.json`

`data.json` sits in the project root and has four parts:

```
{
  "meta":     { replayDate, periodSeconds, alertFlightId, defaultFlightId, notes },
  "airports": [ { code, name, x, y } ],
  "flights":  [ { id, flight, callsign, tail, origin, destination, departed, eta } ],
  "periods":  [ { period, time, positions: { "<flight id>": { x, y, progress, altitude, speed, heading } } } ]
}
```

| Part | What it holds |
|---|---|
| `meta` | Settings for the app. `periodSeconds` is how long one period stays on screen at 1× (5). `alertFlightId` is the flight used by the emergency demo. `defaultFlightId` is the flight open at start-up. |
| `airports` | The 8 airports. `x` and `y` are **percentages of the map** (0 to 100, from the top-left corner), so they line up with the markers and lines. |
| `flights` | Facts about a flight that do not change: flight number, callsign, tail number, origin, destination, departed and ETA times. |
| `periods` | Up to **5 snapshots** in time. Each one lists, for every flight (looked up by its `id`), where it is at that moment. |

How the periods work:

- A period is one moment in time. `positions` is an **object keyed by flight id**, so the app can write `period.positions["AC2210"]` instead of searching a list.
- Each flight's `x` and `y` in each period is a point on the straight line from its **origin airport to its destination airport**. `progress` says how far along that line it is (0 to 100). Moving to the next period moves the flight farther toward its destination.
- `altitude` is `null` when a flight is not reporting one (AC 1187). The page shows **Not available**.
- `departed` and `eta` are fixed placeholder times. They are not tied to the period clock (`12:00`, `12:15`, and so on).
- The trail on the map is built from the periods already shown: origin airport, then every point so far. The dashed line is the current point to the destination airport.

**Adding or changing data:** edit `data.json` only. Add a flight to `flights` and give it a position in **every** period; add a period (up to five) to `periods`. On load, the app checks that every flight has a position in every period and that every flight uses an airport from `airports`. If something is missing, it tells you what on the page and in the browser console.

**Live later:** a live API will return one record per flight in this same shape (`x`/`y` will become `lat`/`lon` when the real map arrives). The live feed replaces the saved periods; the replay will then play back recorded snapshots.

## Folder layout

```
flight-tracker/
  index.html        markup for the whole screen (no flight data inside)
  data.json         airports, flights and the periods (map points over time)
  css/
    styles.css      one stylesheet, sections numbered 1-12
  js/
    quality.js      empty-value and data-quality helpers (loaded first)
    app.js          loads data.json, builds the page, state, update functions, timer, events
  tests/
    quality.test.js Challenge answer key: run with  node tests/quality.test.js
  docs/
    SAMPLE_DATA_DICTIONARY.md   mentor reference for the Week 8 data dictionary
  README.md         this file
```

## How the JavaScript is organized

`js/app.js` follows one pattern that carries straight over to React:

1. **Load**: `loadData()` fetches `data.json`; `checkData()` makes sure it has the shape the app expects.
2. **State**: one `state` object remembers what is going on (the data, which period is showing, selected flight, search text, alert on, and so on).
3. **Build**: `buildFlightList()`, `buildFilters()`, `buildMap()` and `buildReplayBar()` create the rows, airports, markers and lines from the arrays in the data. They run once.
4. **Update functions**: small functions such as `showPeriod()`, `renderMap()`, `selectFlight()`, `renderFlights()` and `setMode()` change the page to match the state.
5. **Period timer**: `scheduleNextPeriod()` uses `setTimeout` to wait `periodSeconds` (divided by the speed), call `showPeriod()` for the next period, and then wait again.
6. **Event listeners**: `wireEvents()` connects each click or keystroke to one of those functions.

Look-up tables (`flightById`, `airportByCode`, `markerById`, ...) turn an id into its record or element in one step.

## Decisions made so far

- **Black and white only.** REQ-09 says aircraft turn red when there is an emergency. In this wireframe the alert flight is shown as a solid black marker with a pulsing outline and a black banner with a ⚠ icon. Red is added when real styling starts.
- **Alerts are never hidden by filters.** If an emergency is active, that flight stays visible in the list and on the map whatever the search or filters say. This was our call; REQ-05 does not say either way.
- **Map is a placeholder.** The grid, airport squares and paths are schematic and not to scale. Airport positions loosely follow US geography.
- **Dim on the map, filter the list.** This is the proposed answer to the students' REQ-05 question and is still to be confirmed in review.
- **Detail panel has two tabs.** Details come from the finalized wireframe. The Chart tab is a placeholder added for the visualization the Week 6 plan calls for; it was not on the Week 5 wireframe.
- **Missing values** show "Not available" (see AC 1187's altitude) instead of a blank. Null, a missing key and empty text all do; a real 0 does not (see "Empty values" above).
- **Live is a placeholder.** There is no live API yet, so LIVE shows the last saved period and the pill says `LIVE · NO FEED YET`. Only REPLAY moves aircraft.
- **One day of replay data.** The date drop-down lists only the date in `data.json` (`meta.replayDate`). Other days arrive with real history.
- **Placeholder numbers.** Positions, speeds and altitudes are made up to show movement, not real flights.
- **Accessibility basics:** real `<button>` elements, labels on inputs, keyboard focus outlines, `aria-pressed` and `aria-expanded` states, and reduced-motion support for the pulsing outline.

## Moving to React / Next.js later

Each block in `index.html` carries a `data-component="..."` name. These are the pieces that become React components.

| In this project | Becomes | Notes |
|---|---|---|
| `Header`, `StatusPill`, `DemoControls` | `Header.jsx` and children | The demo menu can be deleted once real data exists. |
| `Sidebar` → `SearchBox`, `FilterBar`, `FlightList` (rows) | `FlightList.jsx` and children | Rows are already generated from an array (`flights`). |
| `DetailPanel` | `DetailPanel.jsx` | Matches the component of the same name in `ARCHITECTURE.md`. |
| Chart placeholder (`AltitudeChart`) | `AltitudeChart.jsx` | Placeholder for the recharts chart. |
| `MapView` + `TrafficSummary` | `MapView.jsx` + `TrafficSummary.jsx` | The static grid is replaced by react-leaflet. |
| Markers, `FlightPath`, airports | children of `MapView` | Paths use % coordinates now; the map library will use lat/lon. |
| `AlertBanner` | `AlertBanner.jsx` | |
| `ReplayBar` | `ReplayBar.jsx` | |
| `state` object in `app.js` | `useState` hooks lifted to `app/page.js` | Same shape. |
| `scheduleNextPeriod()` timer | A `useEffect` with `setTimeout` or `setInterval` | Same idea: wait, then show the next period. |
| `flights`, `airports`, `periods` in `data.json` | An `aircraft` array from `useAircraftData()` (mock data first, then the live API) | |

**One gap to resolve before the move:** the shared aircraft record in `ARCHITECTURE.md` has callsign, position, altitude, speed, heading and history. The student requirements (REQ-02, REQ-05, REQ-08) also need origin, destination and ETA, and REQ-04 needs tail number. `data.json` already carries those fields (in `flights`), and `periods` plays the role of `history`. The record shape in `ARCHITECTURE.md` will need to be updated to match, or the requirements will need to change.

## Not included on purpose

No live API, no real map, no chart, no build tools, no framework. Those arrive in later weeks.
