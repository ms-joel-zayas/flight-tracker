# Sample Aircraft Data Dictionary (mentor reference, Week 8)

This is one possible answer for the Week 8 deliverable. Students write their own from `data.json`, then compare. It is a reference, not an answer key to copy.

## What the sources say, and what they do not

`data.json` (`meta.notes`) and the README say: `x` and `y` are percentages of the map (0 to 100, from the top-left corner); a period is one snapshot in time; `progress` is how far along the origin-to-destination line a flight is (0 to 100); `altitude` is `null` when a flight is not reporting one; `departed` and `eta` are fixed placeholder times.

They do **not** say the unit of `altitude`, `speed` or `heading`, or what a heading of 0° means. The page adds " ft", " kt" and "°" when it shows them. The units below are therefore **assumptions to confirm** with the data owner, and a student dictionary should mark them that way.

## Dictionary

| Field | Where | Meaning | Type | Unit | Required? | If missing |
|---|---|---|---|---|---|---|
| `id` | flights | Short key that links a flight to its positions | text | none | Yes | Data error: the app cannot link the flight (checkData stops with a message) |
| `flight` | flights | Flight number as people write it (AC 2210) | text | none | Yes | Flag it; the list row would be blank |
| `callsign` | flights | Radio name of the flight | text | none | Yes | Show "Not available" and flag it in the console |
| `tail` | flights | Aircraft registration | text | none | Yes | Search skips it; flag it |
| `origin`, `destination` | flights | Airport code of each end of the route | text | none | Yes | Data error (must exist in `airports`) |
| `departed`, `eta` | flights | Placeholder clock times | text, HH:MM | 24-hour clock | Yes | Show "Not available" |
| `altitude` | periods[].positions | Height of the aircraft | number or null | feet (assumed) | No | Show "Not available" (AC 1187 is null in all 5 periods) |
| `speed` | periods[].positions | How fast the aircraft moves | number | knots (assumed) | Yes | Show "Not available" |
| `heading` | periods[].positions | Direction of travel | number | degrees, 0 to 359 (assumed; meaning of 0 not stated) | Yes | Show "Not available" |
| `progress` | periods[].positions | How far along the route | number | percent, 0 to 100 | Yes | Draw an empty bar |
| `x`, `y` | periods[].positions | Place on the schematic map | number | percent of map width / height | Yes | Marker cannot be placed |

## Quality findings (counted from `data.json`)

| Check | Finding |
|---|---|
| Complete | `altitude` is `null` for AC 1187 in all 5 periods: 5 of 40 altitude values (12.5%). |
| Valid | Headings run 47 to 287, speeds 402 to 475, altitudes 27,000 to 37,000. All plausible; the range rule (heading 0 to 359) is not written in the file. |
| Consistent | AC3306, UA640, WN88 and AA319 have an `eta` earlier than the last period (13:00) but progress below 100%. The notes call `eta` a placeholder. |

Run `node tests/quality.test.js` to re-check these numbers and the four empty-value cases.
