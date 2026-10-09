# Flight Tracker — MVP Wireframe (Week 6)

A static, black-and-white working version of the approved Flight Tracker design, built with only **HTML, CSS and JavaScript**. No build step, no libraries, no data source.

| Language | Job | File |
|---|---|---|
| HTML | Structure: what is on the screen | `index.html` |
| CSS | Presentation: how it looks (black-and-white wireframe) | `css/styles.css` |
| JavaScript | Behavior: what happens on a click or keystroke | `js/app.js` |

## Run it

Double-click `index.html` to open it in a browser. That is all.

If you prefer a local server, run this in the project folder and open http://localhost:8000:

```
python3 -m http.server 8000
```

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
| Click **REPLAY**, then pick a date, speed (1× to 10×), ▶ or the arrows | Replay controls switch on and the status pill shows `REPLAY · OCT 02 · 10×`; **● LIVE** switches back | REQ-07 |

The **Demo** menu exists only because there is no real data yet. It stands in for events that real data will trigger later.

## Folder layout

```
flight-tracker-mvp/
  index.html        markup for the whole screen
  css/
    styles.css      one stylesheet, sections numbered 1-12
  js/
    app.js          state, update functions, event listeners
  README.md         this file
```

## How the JavaScript is organized

`js/app.js` follows one pattern that carries straight over to React:

1. **State**: one `state` object remembers what is going on (selected flight, panel open, search text, alert on, and so on).
2. **Update functions**: small functions such as `selectFlight()`, `renderFlights()`, `setAlert()` and `setMode()` change the page to match the state.
3. **Event listeners**: at the bottom, each click or keystroke calls one of those functions.

Flight details are read from `data-*` attributes on each list row in `index.html` (for example `data-origin="BOS"`). All values are **hard-coded placeholders**, including tail numbers, times and speeds.

## Decisions made at the wireframe stage

- **Black and white only.** REQ-09 says aircraft turn red when there is an emergency. In this wireframe the alert flight is shown as a solid black marker with a pulsing outline and a black banner with a ⚠ icon. Red is added when real styling starts.
- **Alerts are never hidden by filters.** If an emergency is active, that flight stays visible in the list and on the map whatever the search or filters say. This was our call; REQ-05 does not say either way.
- **Map is a placeholder.** The grid, airport squares and paths are schematic and not to scale. Airport positions loosely follow US geography.
- **Dim on the map, filter the list.** This is the proposed answer to the students' REQ-05 question and is still to be confirmed in review.
- **Detail panel has two tabs.** Details come from the finalized wireframe. The Chart tab is a placeholder added for the visualization the Week 6 plan calls for; it was not on the Week 5 wireframe.
- **Missing values** show "Not available" (see AC 1187's altitude) instead of a blank.
- **Accessibility basics:** real `<button>` elements, labels on inputs, keyboard focus outlines, `aria-pressed` and `aria-expanded` states, and reduced-motion support for the pulsing outline.

## Moving to React / Next.js later

Each block in `index.html` carries a `data-component="..."` name. These are the pieces that become React components.

| In this project | Becomes | Notes |
|---|---|---|
| `Header`, `StatusPill`, `DemoControls` | `Header.jsx` and children | The demo menu can be deleted once real data exists. |
| `Sidebar` → `SearchBox`, `FilterBar`, `FlightList` (rows) | `FlightList.jsx` and children | Rows are generated from an array instead of hand-written. |
| `DetailPanel` | `DetailPanel.jsx` | Matches the component of the same name in `ARCHITECTURE.md`. |
| Chart placeholder (`AltitudeChart`) | `AltitudeChart.jsx` | Placeholder for the recharts chart. |
| `MapView` + `TrafficSummary` | `MapView.jsx` + `TrafficSummary.jsx` | The static grid is replaced by react-leaflet. |
| Markers, `FlightPath`, airports | children of `MapView` | Paths use % coordinates now; the map library will use lat/lon. |
| `AlertBanner` | `AlertBanner.jsx` | |
| `ReplayBar` | `ReplayBar.jsx` | |
| `state` object in `app.js` | `useState` hooks lifted to `app/page.js` | Same shape. |
| `data-*` attributes on rows | An `aircraft` array from `useAircraftData()` | |

**One gap to resolve before the move:** the shared aircraft record in `ARCHITECTURE.md` has callsign, position, altitude, speed, heading and history. The student requirements (REQ-02, REQ-05, REQ-08) also need origin, destination and ETA, and REQ-04 needs tail number. The record shape will need those fields, or the requirements will need to change.

## Not included on purpose

No data source, no simulated flight movement, no real map, no chart, no build tools, no framework. Those arrive in later weeks.
