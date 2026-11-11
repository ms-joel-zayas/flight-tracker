/* Answer key (mentor reference) — Weeks 8 and 9, written for Jest
   Run from the project folder:   npm test      (Jest finds every *.test.js file)
   Run one group:                 npx jest -t "latitude"
   Each test() below is one check. expect(actual).toBe(expected) passes when the two
   match. Jest prints PASS or FAIL for the file and names every test that failed.

   What is tested: the four empty values and the heading check (Week 8), the three
   data-quality findings counted from data.json (Week 8), and the latitude and
   longitude checks (Week 9). These are the pure helpers in js/quality.js. The map
   itself is checked by looking at it in the browser. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  emptyKind, formatValue, isValidHeading, isValidLatitude, isValidLongitude,
  hasLocation, locationProblem, summarizeQuality, findInconsistentEtas,
} from "../js/quality.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.join(directory, "..", "data.json"), "utf8"));
const noteTexts = (d) => summarizeQuality(d).map((n) => n.text);
const copyOfData = () => JSON.parse(JSON.stringify(data));


/* ---- Week 8: the four empty values (slide: "Test the four empty values") ---- */
describe("the four empty values", () => {
  const altitude = (record) => formatValue(record.altitude, " ft", (n) => n.toLocaleString("en-US"));

  test('"altitude": null shows Not available',        () => expect(altitude({ altitude: null }).text).toBe("Not available"));
  test("a missing altitude key shows Not available",  () => expect(altitude({}).text).toBe("Not available"));
  test('"altitude": 0 shows 0 ft (a real zero)',      () => expect(altitude({ altitude: 0 }).text).toBe("0 ft"));
  test('"callsign": "" shows Not available',          () => expect(formatValue("").text).toBe("Not available"));
  test("33000 shows 33,000 ft",                       () => expect(altitude({ altitude: 33000 }).text).toBe("33,000 ft"));

  test.each([
    ["empty text is reported as empty", "", "empty"],
    ["null is reported as null",        null, "null"],
    ["a missing key is reported as missing", undefined, "missing"],
    ["0 is not empty",                  0, ""],
  ])("emptyKind: %s", (label, value, expected) => expect(emptyKind(value)).toBe(expected));
});


/* ---- Week 8 Challenge answer: heading is valid only for numbers from 0 to 359 ---- */
describe("isValidHeading", () => {
  test.each([
    [0, true], [268, true], [359, true],
    [360, false], [-1, false], ["268", false], [null, false], [undefined, false], [NaN, false],
  ])("isValidHeading(%p) is %p", (value, expected) => expect(isValidHeading(value)).toBe(expected));
});


/* ---- Week 8: the findings on the "Inspect Before You Trust" slide, counted from data.json ---- */
describe("data quality findings in data.json", () => {
  const notes = noteTexts(data);

  test("Complete: altitude is empty in 5 of 40 positions (12.5%)",
    () => expect(notes.some((t) => t.includes("altitude is empty in 5 of 40 positions (12.5%)"))).toBe(true));
  test("Valid: no heading is outside 0-359",
    () => expect(notes.some((t) => t.includes("outside 0-359"))).toBe(false));
  test("Consistent: AC3306, UA640, WN88 and AA319 have an early ETA",
    () => expect(findInconsistentEtas(data)).toEqual(["AC3306", "UA640", "WN88", "AA319"]));
});


/* ---- Week 9: latitude and longitude ---- */
describe("latitude", () => {
  test.each([[47.4502, true], [0, true], [-90, true], [90, true], [91, false], [-122.3088, false], ["47.4", false], [null, false], [undefined, false]])(
    "isValidLatitude(%p) is %p", (value, expected) => expect(isValidLatitude(value)).toBe(expected));
});

describe("longitude", () => {
  test.each([[-122.3088, true], [0, true], [180, true], [-180, true], [181, false], ["-122", false], [null, false], [undefined, false]])(
    "isValidLongitude(%p) is %p", (value, expected) => expect(isValidLongitude(value)).toBe(expected));
});

describe("hasLocation: can the map draw it?", () => {
  test("Boston is drawable",                      () => expect(hasLocation({ lat: 42.3656, lon: -71.0096 })).toBe(true));
  test("a missing lat is not drawable",           () => expect(hasLocation({ lon: -71.0096 })).toBe(false));
  test("a null lat is not drawable",              () => expect(hasLocation({ lat: null, lon: -71.0096 })).toBe(false));
  test("lat 0, lon 0 IS drawable (a real place)", () => expect(hasLocation({ lat: 0, lon: 0 })).toBe(true));
  test("nothing at all is not drawable",          () => expect(hasLocation(undefined)).toBe(false));
});

describe("locationProblem: say what is wrong", () => {
  test("a swapped Seattle (out of range) is named", () => {
    expect(locationProblem({ lat: -122.3088, lon: 47.4502 })).toContain("look swapped");
  });
  test("a swapped Boston is NOT caught: both numbers stay in range, only the map shows it", () => {
    expect(locationProblem({ lat: -71.0096, lon: 42.3656 })).toBe("");
  });
  test("an out-of-range pair is named", () => {
    expect(locationProblem({ lat: 400, lon: 500 })).toContain("outside the valid range");
  });
  test("a missing key is named", () => {
    expect(locationProblem({ lat: 42.3 })).toBe("is missing lat or lon");
  });
  test("a good place has no problem", () => {
    expect(locationProblem({ lat: 42.3656, lon: -71.0096 })).toBe("");
  });
});

describe("the real data.json uses lat and lon", () => {
  const places = [...data.airports, ...data.periods.flatMap((p) => Object.values(p.positions))];

  test("every airport and position has a usable lat and lon (8 airports + 40 positions)", () => {
    expect(places).toHaveLength(48);
    expect(places.every(hasLocation)).toBe(true);
  });
  test("no x or y is left in data.json", () => {
    expect(places.some((place) => "x" in place || "y" in place)).toBe(false);
  });
  test("the quality summary reports no lat/lon problem", () => {
    expect(noteTexts(data).some((t) => t.startsWith("Valid?") && /lat|lon/.test(t))).toBe(false);
  });
});

describe("a damaged copy of data.json is reported", () => {
  const broken = copyOfData();
  broken.periods[2].positions.AC1187 = { ...broken.periods[2].positions.AC1187, lat: -122.3, lon: 38.5 };   // lat and lon typed in the wrong order
  broken.airports[3].lon = null;                                                                           // DEN loses its longitude
  const notes = noteTexts(broken);

  test("a swapped lat/lon is reported for AC1187 in period 3", () => {
    expect(notes.some((t) => t.includes("AC1187 in period 3") && t.includes("look swapped"))).toBe(true);
  });
  test("a missing airport lon is reported for DEN", () => {
    expect(notes.some((t) => t.includes("airport DEN is missing lat or lon"))).toBe(true);
  });
  test("the original data is not changed by the copy", () => {
    expect(hasLocation(data.airports[3])).toBe(true);
  });
});
