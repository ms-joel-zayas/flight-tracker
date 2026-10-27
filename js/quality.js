/* =====================================================================
   FLIGHT TRACKER — data-quality helpers (Week 8 reference, v3-final)
   Small "pure" functions: they take values in and give answers back, and
   they never touch the page. That makes them easy to test (see
   tests/quality.test.js) and easy to read.

   The four "empty" situations from the Week 8 slides:
     null          the key is there, but no value is known
     missing       the key is not in the record (JavaScript gives undefined)
     empty         text with nothing in it ("")
     0             NOT empty: a real measurement that happens to be zero
   ===================================================================== */

/* Which kind of "no value" is this? Returns "" when a value is present (0 counts as present). */
function emptyKind(value) {
  if (value === null) return "null";
  if (value === undefined) return "missing";
  if (typeof value === "string" && value.trim() === "") return "empty";
  return "";
}

function isMissing(value) {
  return emptyKind(value) !== "";
}

/* The text the page should show. A present value gets its unit; an empty one gets "Not available".
   Because we check the kind and not "is it falsy?", a real 0 stays "0 ft". */
function formatValue(value, suffix = "", format = String) {
  const kind = emptyKind(value);
  if (kind) return { text: "Not available", missing: true, kind };
  return { text: format(value) + suffix, missing: false, kind: "" };
}

/* Challenge answer: a heading is valid only if it is a number from 0 to 359.
   (Our file uses whole degrees. Decimal headings above 359 would need a rule from the data owner.) */
function isValidHeading(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 359;
}

/* Flights whose ETA is earlier than the last period's clock time, yet are not at 100% progress.
   data.json calls ETA a placeholder, so this is documented, but it is still worth reporting. */
function findInconsistentEtas(data) {
  const last = data.periods[data.periods.length - 1];
  return data.flights
    .filter((f) => {
      const pos = last.positions[f.id];
      return typeof f.eta === "string" && f.eta < last.time && pos && pos.progress < 100;   // "HH:MM" text sorts in time order
    })
    .map((f) => f.id);
}

/* Read the data and describe what a person should know about its quality.
   Returns a list of { level: "info" | "warn", text }. The app prints them to the console. */
function summarizeQuality(data) {
  const notes = [];

  ["altitude", "speed", "heading"].forEach((field) => {
    let total = 0;
    let empty = 0;
    data.periods.forEach((p) => Object.values(p.positions).forEach((pos) => {
      total += 1;
      if (isMissing(pos[field])) empty += 1;
    }));
    if (empty > 0) {
      notes.push({ level: "info", text: `Complete? ${field} is empty in ${empty} of ${total} positions (${(100 * empty / total).toFixed(1)}%).` });
    }
  });

  data.periods.forEach((p) => Object.entries(p.positions).forEach(([flightId, pos]) => {
    if (!isMissing(pos.heading) && !isValidHeading(pos.heading)) {
      notes.push({ level: "warn", text: `Valid? ${flightId} in period ${p.period} has heading ${pos.heading}, outside 0-359.` });
    }
  }));

  data.flights.forEach((f) => {
    ["flight", "callsign", "tail"].forEach((field) => {
      if (isMissing(f[field])) notes.push({ level: "warn", text: `Complete? ${f.id} has an empty "${field}".` });
    });
  });

  const etas = findInconsistentEtas(data);
  if (etas.length > 0) {
    notes.push({ level: "info", text: `Consistent? ${etas.join(", ")}: ETA is before the last period but progress is below 100% (ETA is a placeholder in data.json).` });
  }

  return notes;
}

/* In the browser these are plain globals. In Node (the tests) they are exported. */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { emptyKind, isMissing, formatValue, isValidHeading, findInconsistentEtas, summarizeQuality };
}
