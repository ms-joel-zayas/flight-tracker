import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

function isoOrNull(timestamp) {
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function timestampOrNull(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function rowToPoint(row) {
  return {
    id: row.aircraft_id,
    flightSessionId: row.flight_session_id,
    capturedAt: new Date(row.captured_at).toISOString(),
    observedAt: new Date(row.observed_at).toISOString(),
    callsign: row.callsign,
    flightNumber: row.flight_number,
    tailNumber: row.tail_number,
    aircraftType: row.aircraft_type,
    latitude: row.latitude,
    longitude: row.longitude,
    altitudeFeet: row.altitude_feet,
    speedKnots: row.speed_knots,
    headingDegrees: row.heading_degrees,
    origin: row.origin,
    destination: row.destination,
    onGround: row.on_ground === null ? null : Boolean(row.on_ground),
    firstObservedAt: isoOrNull(row.first_observed_at),
    departureTime: isoOrNull(row.departure_time),
    departureTimeSource: row.departure_time_source,
    eta: isoOrNull(row.eta),
    etaSource: row.eta_source,
    progressPercent: row.progress_percent,
    remainingDistanceNm: row.remaining_distance_nm,
    emergencyActive: Boolean(row.emergency_active),
  };
}

function rowToAirport(row) {
  return {
    code: row.code,
    iata: row.iata,
    icao: row.icao,
    name: row.name,
    latitude: row.latitude,
    longitude: row.longitude,
  };
}

export class HistoryStore {
  constructor(filename) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.database = new Database(filename);
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("synchronous = NORMAL");
    this.createSchema();
    this.migrateSchema();
    this.prepareStatements();
  }

  createSchema() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS positions (
        aircraft_id TEXT NOT NULL,
        flight_session_id TEXT,
        captured_at INTEGER NOT NULL,
        observed_at INTEGER NOT NULL,
        callsign TEXT,
        flight_number TEXT,
        tail_number TEXT,
        aircraft_type TEXT,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        altitude_feet REAL,
        speed_knots REAL,
        heading_degrees REAL,
        origin TEXT,
        destination TEXT,
        on_ground INTEGER,
        first_observed_at INTEGER,
        departure_time INTEGER,
        departure_time_source TEXT,
        eta INTEGER,
        eta_source TEXT,
        progress_percent INTEGER,
        remaining_distance_nm REAL,
        emergency_active INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (aircraft_id, captured_at)
      );

      CREATE INDEX IF NOT EXISTS positions_by_time
        ON positions (captured_at);

      CREATE TABLE IF NOT EXISTS airports (
        code TEXT PRIMARY KEY,
        iata TEXT,
        icao TEXT,
        name TEXT,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS route_cache (
        callsign TEXT PRIMARY KEY,
        route_json TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS provider_usage (
        provider TEXT NOT NULL,
        day_utc TEXT NOT NULL,
        request_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (provider, day_utc)
      );
    `);
  }

  migrateSchema() {
    const existing = new Set(
      this.database.prepare("PRAGMA table_info(positions)").all().map((column) => column.name),
    );
    const additions = {
      flight_session_id: "TEXT",
      flight_number: "TEXT",
      aircraft_type: "TEXT",
      on_ground: "INTEGER",
      first_observed_at: "INTEGER",
      departure_time: "INTEGER",
      departure_time_source: "TEXT",
      eta: "INTEGER",
      eta_source: "TEXT",
      progress_percent: "INTEGER",
      remaining_distance_nm: "REAL",
    };
    for (const [name, type] of Object.entries(additions)) {
      if (!existing.has(name)) this.database.exec(`ALTER TABLE positions ADD COLUMN ${name} ${type}`);
    }
  }

  prepareStatements() {
    this.insertAirport = this.database.prepare(`
      INSERT INTO airports (
        code, iata, icao, name, latitude, longitude, updated_at
      ) VALUES (
        @code, @iata, @icao, @name, @latitude, @longitude, @updated_at
      )
      ON CONFLICT(code) DO UPDATE SET
        iata = COALESCE(excluded.iata, airports.iata),
        icao = COALESCE(excluded.icao, airports.icao),
        name = COALESCE(excluded.name, airports.name),
        latitude = excluded.latitude,
        longitude = excluded.longitude,
        updated_at = excluded.updated_at
    `);
    this.insertPosition = this.database.prepare(`
      INSERT OR REPLACE INTO positions (
        aircraft_id, flight_session_id, captured_at, observed_at, callsign,
        flight_number, tail_number, aircraft_type, latitude, longitude,
        altitude_feet, speed_knots, heading_degrees,
        origin, destination, on_ground, first_observed_at, departure_time,
        departure_time_source, eta, eta_source, progress_percent,
        remaining_distance_nm, emergency_active
      ) VALUES (
        @aircraft_id, @flight_session_id, @captured_at, @observed_at, @callsign,
        @flight_number, @tail_number, @aircraft_type, @latitude, @longitude,
        @altitude_feet, @speed_knots, @heading_degrees,
        @origin, @destination, @on_ground, @first_observed_at, @departure_time,
        @departure_time_source, @eta, @eta_source, @progress_percent,
        @remaining_distance_nm, @emergency_active
      )
    `);
    this.insertSnapshot = this.database.transaction((aircraft, capturedAtMs) => {
      for (const item of aircraft) {
        for (const airport of item.route?.waypoints || []) {
          if (!airport.code || !Number.isFinite(airport.latitude) || !Number.isFinite(airport.longitude)) continue;
          this.insertAirport.run({
            code: airport.code,
            iata: airport.iata || null,
            icao: airport.icao || null,
            name: airport.name || null,
            latitude: airport.latitude,
            longitude: airport.longitude,
            updated_at: capturedAtMs,
          });
        }
        this.insertPosition.run({
          aircraft_id: item.id,
          flight_session_id: item.flightSessionId || null,
          captured_at: capturedAtMs,
          observed_at: Date.parse(item.observedAt),
          callsign: item.callsign,
          flight_number: item.flightNumber || null,
          tail_number: item.tailNumber,
          aircraft_type: item.aircraftType || null,
          latitude: item.latitude,
          longitude: item.longitude,
          altitude_feet: item.altitudeFeet,
          speed_knots: item.speedKnots,
          heading_degrees: item.headingDegrees,
          origin: item.origin,
          destination: item.destination,
          on_ground: item.onGround === null || item.onGround === undefined ? null : item.onGround ? 1 : 0,
          first_observed_at: timestampOrNull(item.firstObservedAt),
          departure_time: timestampOrNull(item.departureTime),
          departure_time_source: item.departureTimeSource,
          eta: timestampOrNull(item.eta),
          eta_source: item.etaSource,
          progress_percent: item.progressPercent,
          remaining_distance_nm: item.remainingDistanceNm,
          emergency_active: item.emergency ? 1 : 0,
        });
      }
    });
    this.deleteOldPositions = this.database.prepare(
      "DELETE FROM positions WHERE captured_at < ?",
    );
    this.selectHistory = this.database.prepare(`
      SELECT * FROM positions
      WHERE aircraft_id = ? AND captured_at BETWEEN ? AND ?
      ORDER BY captured_at ASC
      LIMIT ?
    `);
    this.selectReplay = this.database.prepare(`
      SELECT * FROM positions
      WHERE captured_at BETWEEN ? AND ?
      ORDER BY captured_at ASC, aircraft_id ASC
      LIMIT ?
    `);
    this.selectBucketedReplay = this.database.prepare(`
      WITH frame_times AS (
        SELECT CAST(captured_at / ? AS INTEGER) AS time_bucket,
               MAX(captured_at) AS captured_at
        FROM positions
        WHERE captured_at BETWEEN ? AND ?
        GROUP BY time_bucket
      )
      SELECT positions.*
      FROM positions
      INNER JOIN frame_times USING (captured_at)
      ORDER BY positions.captured_at ASC, positions.aircraft_id ASC
      LIMIT ?
    `);
    this.selectReplayDates = this.database.prepare(`
      SELECT DISTINCT strftime('%Y-%m-%d', captured_at / 1000, 'unixepoch') AS day
      FROM positions
      ORDER BY day DESC
    `);
    this.selectAirportsForWindow = this.database.prepare(`
      SELECT airports.*
      FROM airports
      INNER JOIN (
        SELECT origin AS code FROM positions
        WHERE captured_at BETWEEN ? AND ? AND origin IS NOT NULL
        UNION
        SELECT destination AS code FROM positions
        WHERE captured_at BETWEEN ? AND ? AND destination IS NOT NULL
      ) AS used_airports USING (code)
      ORDER BY airports.code ASC
    `);
    this.selectRouteCache = this.database.prepare(`
      SELECT route_json, expires_at
      FROM route_cache
      WHERE callsign = ? AND expires_at > ?
    `);
    this.upsertRouteCache = this.database.prepare(`
      INSERT INTO route_cache (callsign, route_json, expires_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(callsign) DO UPDATE SET
        route_json = excluded.route_json,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `);
    this.selectUsage = this.database.prepare(`
      SELECT request_count FROM provider_usage
      WHERE provider = ? AND day_utc = ?
    `);
    this.incrementUsage = this.database.prepare(`
      INSERT INTO provider_usage (provider, day_utc, request_count)
      VALUES (?, ?, 1)
      ON CONFLICT(provider, day_utc)
      DO UPDATE SET request_count = request_count + 1
    `);
    this.deleteOldUsage = this.database.prepare(
      "DELETE FROM provider_usage WHERE day_utc < ?",
    );
  }

  recordSnapshot(aircraft, capturedAtMs = Date.now()) {
    if (aircraft.length) this.insertSnapshot(aircraft, capturedAtMs);
  }

  removePositionsBefore(timestampMs) {
    return this.deleteOldPositions.run(timestampMs).changes;
  }

  getHistory(aircraftId, fromMs, toMs, limit = 10_000) {
    return this.selectHistory
      .all(aircraftId.toLowerCase(), fromMs, toMs, limit)
      .map(rowToPoint);
  }

  getReplay(fromMs, toMs, limit = 50_001) {
    return this.selectReplay.all(fromMs, toMs, limit).map(rowToPoint);
  }

  getBucketedReplay(fromMs, toMs, intervalSeconds, limit = 50_001) {
    const intervalMs = Math.max(1, Math.round(intervalSeconds * 1000));
    return this.selectBucketedReplay
      .all(intervalMs, fromMs, toMs, limit)
      .map(rowToPoint);
  }

  getReplayDates() {
    return this.selectReplayDates.all().map((row) => row.day);
  }

  getAirportsForWindow(fromMs, toMs) {
    return this.selectAirportsForWindow
      .all(fromMs, toMs, fromMs, toMs)
      .map(rowToAirport);
  }

  getRouteCache(callsign, nowMs = Date.now()) {
    const cached = this.selectRouteCache.get(callsign.toUpperCase(), nowMs);
    if (!cached) return null;
    try {
      return { route: JSON.parse(cached.route_json), expiresAt: cached.expires_at };
    } catch {
      return null;
    }
  }

  setRouteCache(callsign, route, expiresAt, updatedAt = Date.now()) {
    this.upsertRouteCache.run(
      callsign.toUpperCase(),
      JSON.stringify(route ?? null),
      expiresAt,
      updatedAt,
    );
  }

  getProviderUsage(provider, dayUtc) {
    return this.selectUsage.get(provider, dayUtc)?.request_count || 0;
  }

  countProviderRequest(provider, dayUtc) {
    this.incrementUsage.run(provider, dayUtc);
    return this.getProviderUsage(provider, dayUtc);
  }

  removeProviderUsageBefore(dayUtc) {
    this.deleteOldUsage.run(dayUtc);
  }

  close() {
    this.database.close();
  }
}
