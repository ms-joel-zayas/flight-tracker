/* Challenge answer key (mentor reference) — Week 8
   Run from the project folder:   node tests/quality.test.js
   It records PASS or FAIL for the four empty values, the heading check,
   and the three data-quality findings shown on the Week 8 slides. */

const fs = require("fs");
const path = require("path");
const { emptyKind, formatValue, isValidHeading, summarizeQuality, findInconsistentEtas } = require("../js/quality.js");

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

/* ---- Print the results ---- */
results.forEach((r) => console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.label}${r.pass ? "" : `   (got ${JSON.stringify(r.actual)}, expected ${JSON.stringify(r.expected)})`}`));
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed} of ${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
