/* Answer key (mentor reference) — Week 8 and Week 9
   Run from the project folder:   npm test      (or: node tests/quality.test.js)
   It records PASS or FAIL for the four empty values, the heading check,
   the three data-quality findings from Week 8, and the latitude/longitude
   checks added in Week 9. */

const fs = require("fs");
const path = require("path");
const { emptyKind, formatValue, isValidHeading, isValidLatitude, isValidLongitude, hasLocation, locationProblem, summarizeQuality, findInconsistentEtas } = require("../js/quality.js");

const results = [];
function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ label, pass, actual, expected });
}

/* ---- The four empty values (slide: "Test the four empty values") ---- */
const altitude = (record) => formatValue(record.altitude, " ft", (n) => n.toLocaleString("en-US"));
check('"altitude": null  -> Not available',            altitude({ altitude: null }).text, "Not available");
check('(no "altitude" key) -> Not available',           altitude({}).text, "Not available");
check('"altitude": 0  -> 0 ft (a real zero)',           altitude({ altitude: 0 }).text, "0 ft");
check('"callsign": ""  -> Not available',               formatValue("").text, "Not available");
check('"callsign": ""  is flagged as empty text',       emptyKind(""), "empty");
check('null is reported as null',                       emptyKind(null), "null");
check('a missing key is reported as missing',           emptyKind(undefined), "missing");
check('0 is not empty',                                 emptyKind(0), "");
check('33000 -> 33,000 ft',                             altitude({ altitude: 33000 }).text, "33,000 ft");

/* ---- isValidHeading: true only for numbers from 0 to 359 ---- */
[[0, true], [268, true], [359, true], [360, false], [-1, false], ["268", false], [null, false], [undefined, false], [NaN, false]]
  .forEach(([value, expected]) => check(`isValidHeading(${typeof value === "string" ? `"${value}"` : String(value)})`, isValidHeading(value), expected));

/* ---- The findings on the "Inspect Before You Trust" slide, counted from data.json ---- */
const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data.json"), "utf8"));
const notes = summarizeQuality(data).map((n) => n.text);
check("Complete: altitude is empty in 5 of 40 positions (12.5%)", notes.some((t) => t.includes("altitude is empty in 5 of 40 positions (12.5%)")), true);
check("Valid: no heading outside 0-359",                          notes.some((t) => t.startsWith("Valid?")), false);
check("Consistent: AC3306, UA640, WN88, AA319 have an early ETA", findInconsistentEtas(data), ["AC3306", "UA640", "WN88", "AA319"]);

/* ---- Week 9: latitude and longitude ---- */
[[47.4502, true], [0, true], [-90, true], [90, true], [91, false], [-122.3088, false], ["47.4", false], [null, false], [undefined, false]]
  .forEach(([value, expected]) => check(`isValidLatitude(${typeof value === "string" ? `"${value}"` : String(value)})`, isValidLatitude(value), expected));
[[-122.3088, true], [0, true], [180, true], [-180, true], [181, false], ["-122", false], [null, false], [undefined, false]]
  .forEach(([value, expected]) => check(`isValidLongitude(${typeof value === "string" ? `"${value}"` : String(value)})`, isValidLongitude(value), expected));

check("hasLocation: Boston is drawable",                  hasLocation({ lat: 42.3656, lon: -71.0096 }), true);
check("hasLocation: lat missing is not drawable",         hasLocation({ lon: -71.0096 }), false);
check("hasLocation: lat null is not drawable",            hasLocation({ lat: null, lon: -71.0096 }), false);
check("hasLocation: lat 0, lon 0 IS drawable (a real place)", hasLocation({ lat: 0, lon: 0 }), true);
check("locationProblem: swapped Seattle (out of range) is named", locationProblem({ lat: -122.3088, lon: 47.4502 }).includes("look swapped"), true);
check("locationProblem: swapped Boston is NOT caught (both numbers stay in range; only the map shows it)", locationProblem({ lat: -71.0096, lon: 42.3656 }), "");
check("locationProblem: out of range is named",           locationProblem({ lat: 400, lon: 500 }).includes("outside the valid range"), true);
check("locationProblem: missing key is named",            locationProblem({ lat: 42.3 }), "is missing lat or lon");
check("locationProblem: a good place has no problem",     locationProblem({ lat: 42.3656, lon: -71.0096 }), "");

/* ---- Week 9: the real data.json uses lat and lon ---- */
const allPlaces = [...data.airports, ...data.periods.flatMap((p) => Object.values(p.positions))];
check("Every airport and position has a usable lat and lon (8 airports + 40 positions)", [allPlaces.length, allPlaces.every(hasLocation)], [48, true]);
check("No x or y is left in data.json",                   allPlaces.some((place) => "x" in place || "y" in place), false);
check("The quality summary reports no lat/lon problem",   notes.some((t) => /lat|lon/.test(t) && t.startsWith("Valid?")), false);

const broken = JSON.parse(JSON.stringify(data));
broken.periods[2].positions.AC1187 = { ...broken.periods[2].positions.AC1187, lat: -122.3, lon: 38.5 };       // lat and lon typed in the wrong order
broken.airports[3].lon = null;                                                                                 // DEN loses its longitude
const brokenNotes = summarizeQuality(broken).map((n) => n.text);
check("A swapped lat/lon is reported for AC1187 in period 3", brokenNotes.some((t) => t.includes("AC1187 in period 3") && t.includes("look swapped")), true);
check("A missing airport lon is reported for DEN",            brokenNotes.some((t) => t.includes("airport DEN is missing lat or lon")), true);

/* ---- Print the results ---- */
results.forEach((r) => console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.label}${r.pass ? "" : `   (got ${JSON.stringify(r.actual)}, expected ${JSON.stringify(r.expected)})`}`));
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed} of ${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
