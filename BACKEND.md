# Flight Tracker Backend

The backend is a small API built for the existing HTML/CSS/JavaScript frontend. It polls ADSB.lol once every 30 seconds, normalizes provider-specific field names, and stores a rolling 24-hour position history in SQLite. AirLabs is optional and is called only when a selected flight needs better route or ETA details.

## Run it

Requirements: Node.js 20 or newer.

```sh
npm install
cp .env.example .env
npm start
```

Open http://localhost:3000. The same server provides both the wireframe and the API, so frontend code can use a relative URL:

```js
const { aircraft, meta } = await fetch("/api/aircraft").then((response) => response.json());
```

## Provider configuration

`ADSBLOL_API_TOKEN` is intentionally blank because ADSB.lol does not currently require a token. It is included as a future-facing placeholder. `AIRLABS_API_KEY` is also blank; when it stays blank, the backend works with ADSB.lol alone and reports AirLabs enrichment as disabled.

Never put a real token in `js/app.js` or commit `.env`. Copy `.env.example` to `.env` and add secrets only to that ignored file.

## Frontend-facing endpoints

| Endpoint | Frontend use |
|---|---|
| `GET /api/aircraft` | Current map markers, list, search and filters |
| `GET /api/aircraft/:id` | Selected-flight details and optional AirLabs ETA |
| `GET /api/aircraft/:id/history` | Solid trail behind one aircraft |
| `GET /api/replay?from=...&to=...` | Recent replay frames, up to the configured retention period |
| `GET /api/health` | Feed health, last update and enabled providers |

The frontend never depends on provider-specific names such as `alt_baro`, `gs` or `r`. The backend translates them to `altitudeFeet`, `speedKnots` and `tailNumber`, so a future provider change does not require a frontend rewrite.

Time ranges accept ISO-8601 dates or millisecond timestamps. Replay responses are limited to 50,000 position rows so a browser cannot accidentally request an unbounded response.

## Tests

```sh
npm test
```

The wireframe is not connected to these endpoints yet. That integration remains a separate student-facing step. The backend is implemented on `feature/backend-api`; the `v1-uxbridge` and `v1-final` teaching branches remain unchanged.

