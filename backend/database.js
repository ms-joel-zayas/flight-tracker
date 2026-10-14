import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

function rowToPoint(row) {
  return {
    id: row.aircraft_id,
    capturedAt: new Date(row.captured_at).toISOString(),
    observedAt: new Date(row.observed_at).toISOString(),
    callsign: row.callsign,
    tailNumber: row.tail_number,
    latitude: row.latitude,
    longitude: row.longitude,
    altitudeFeet: row.altitude_feet,
    speedKnots: row.speed_knots,
    headingDegrees: row.heading_degrees,
    origin: row.origin,
    destination: row.destination,
    emergencyActive: Boolean(row.emergency_active),
  };
}

export class HistoryStore {
  constructor(filename) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.database = new Database(filename);
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("synchronous = NORMAL");
    this.createSchema();
    this.prepareStatements();
  }

  createSchema() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS positions (
        aircraft_id TEXT NOT NULL,
        captured_at INTEGER NOT NULL,
        observed_at INTEGER NOT NULL,
        callsign TEXT,
        tail_number TEXT,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        altitude_feet REAL,
        speed_knots REAL,
        heading_degrees REAL,
        origin TEXT,
        destination TEXT,
        emergency_active INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (aircraft_id, captured_at)
      );

      CREATE INDEX IF NOT EXISTS positions_by_time
        ON positions (captured_at);

      CREATE TABLE IF NOT EXISTS provider_usage (
        provider TEXT NOT NULL,
        day_utc TEXT NOT NULL,
        request_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (provider, day_utc)
      );
    `);
  }

  prepareStatements() {
    this.insertPosition = this.database.prepare(`
      INSERT OR REPLACE INTO positions (
        aircraft_id, captured_at, observed_at, callsign, tail_number,
        latitude, longitude, altitude_feet, speed_knots, heading_degrees,
        origin, destination, emergency_active
      ) VALUES (
        @aircraft_id, @captured_at, @observed_at, @callsign, @tail_number,
        @latitude, @longitude, @altitude_feet, @speed_knots, @heading_degrees,
        @origin, @destination, @emergency_active
      )
    `);
    this.insertSnapshot = this.database.transaction((aircraft, capturedAtMs) => {
      for (const item of aircraft) {
        this.insertPosition.run({
          aircraft_id: item.id,
          captured_at: capturedAtMs,
          observed_at: Date.parse(item.observedAt),
          callsign: item.callsign,
          tail_number: item.tailNumber,
          latitude: item.latitude,
          longitude: item.longitude,
          altitude_feet: item.altitudeFeet,
          speed_knots: item.speedKnots,
          heading_degrees: item.headingDegrees,
          origin: item.origin,
          destination: item.destination,
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

