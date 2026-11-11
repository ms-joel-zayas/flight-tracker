/*
 * DEMO_FAILURE: make the live feed fail ON PURPOSE, so a presentation can show
 * a failure state through the real code path. Mentor-only; off by default.
 *
 *   DEMO_FAILURE=down     every position provider fails from the start ("Waiting for live flight data")
 *   DEMO_FAILURE=stale    the first update works, then every later one fails
 *                         (aircraft stay on the map, "RETRYING", then "DATA STALE" after STALE_AFTER_SECONDS)
 *   DEMO_FAILURE=empty    the provider answers with no aircraft ("No aircraft in the tracking area")
 *   DEMO_FAILURE=timeout  /api/aircraft answers too late for the browser's 10 s limit
 *                         (handled in backend/app.js, not here)
 */
export const DEMO_FAILURE_MODES = Object.freeze(["", "down", "stale", "empty", "timeout"]);

export class DemoFailureProvider {
  constructor(provider, mode) {
    this.provider = provider;
    this.mode = mode;
    this.name = provider.name;
    this.calls = 0;
  }

  async fetchAircraft(region) {
    this.calls += 1;
    if (this.mode === "down" || (this.mode === "stale" && this.calls > 1)) {
      throw new Error(`DEMO_FAILURE=${this.mode}: ${this.name} is pretending to be unreachable`);
    }
    if (this.mode === "empty") {
      return { ac: [], now: Date.now(), provider: this.name };
    }
    return this.provider.fetchAircraft(region);
  }

  fetchRoutes(aircraft) {
    return this.provider.fetchRoutes(aircraft);
  }
}
