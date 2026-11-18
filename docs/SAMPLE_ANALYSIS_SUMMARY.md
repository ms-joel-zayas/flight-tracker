# Sample Flight Data Analysis Summary (mentor reference)

> Mentor reference for Week 11. Compare with it after you finish your own analysis, not before. Every number here can be reproduced from `data/recorded-day.csv` with `npm run analyze -- data/recorded-day.csv` or with a spreadsheet.

## 1. Questions

1. How many different aircraft passed through our 25 nm tracking area during the recording?
2. Was there a busy hour, or was traffic steady?
3. What share of the data is missing, and which fields are missing most?
4. How often does an aircraft's position actually update? (REQ-03 asked for 5 seconds; our collector saves every 30 seconds.)

## 2. Data

- **File:** `data/recorded-day.csv`, exported from the backend's SQLite history (`/api/export`).
- **Window:** Tuesday 17 November 2026, 5:27 pm to 7:34 pm Uxbridge time (22:27 to 00:34 UTC). About 2 hours 7 minutes, with no gaps in recording.
- **Size:** 3,640 rows in 255 snapshots (one every 30 seconds). Each row is one aircraft at one moment.
- **Area:** within 25 nm of Uxbridge (42.0773, −71.6295). Only aircraft that broadcast their position are included.

## 3. Method

- **JavaScript:** `js/analysis.js` (`summarize`, `aircraftPerHour`, `missingRate`, `updateGaps`), run with `npm run analyze`.
- **Spreadsheet:** the CSV opened in a spreadsheet; `COUNTA`, `COUNTBLANK`, `AVERAGEIFS`, `MIN`, `MAX`, `COUNTIF`.
- **Distinct aircraft:** count of distinct `aircraft_id` values, not rows.
- **Altitude and speed:** airborne rows only (`on_ground` = 0). Empty cells left out.
- **Times:** converted from UTC to Uxbridge time (UTC − 5 in November).

## 4. Results

| Question | Result |
| --- | --- |
| Q1 Different aircraft | **193 aircraft** from 3,640 rows (about 19 rows per aircraft). Median time in view: 6.5 minutes. |
| Q2 Aircraft per hour (local) | 5 pm: 69 (33 minutes recorded) · 6 pm: **101** (full hour) · 7 pm: 62 (34 minutes recorded) |
| Q2 Average aircraft in view at once | 5 pm: 15.5 · 6 pm: 14.0 · 7 pm: 13.6 (range 8 to 26) |
| Q3 Missing values (share of rows) | Route (origin): **71.2%** · Altitude: 8.6% · Callsign: 1.4% · Aircraft type: 0.3% |
| Q3 Aircraft with a route at any point | 82 of 193 (42%). Airline-style callsigns: 77 of 142 (54%). N-number callsigns: 4 of 43 (9%). |
| Q4 Time between updates | Median **30 seconds**. 97.4% of 3,447 gaps were about 30 s; 41 were over 60 s. |
| Altitude, airborne (n = 3,328) | Minimum −400 ft · median 8,175 ft · average 12,696 ft · maximum 41,000 ft |
| Speed, airborne | Maximum 518 kt · average 257 kt |
| Emergencies | 0 rows |

## 5. Cross-check

- **Spreadsheet matched JavaScript exactly** on six results:
  - rows (3,640)
  - airborne rows (3,328)
  - missing callsign, missing altitude and missing route rates
  - average airborne altitude (12,696.1 ft)
  - minimum and maximum altitude
  - maximum speed
- **Distinct aircraft (193):** confirmed with a separate count written in Python.
- **Spreadsheet surprise:** opening the CSV turned 6 aircraft IDs made only of digits (68 rows) into numbers, and `040128` lost its leading zero (`40128`).
  - The counts were not affected, but any lookup by `aircraft_id` would fail.
  - Fix: import with "Convert text to numbers" turned off (Google Sheets), or set the column type to Text (Excel).

## 6. What the data shows, and what it does not prove

**Observations** (checkable from the file):

- **Traffic was steady.** About 14 aircraft were in view at any moment in every hour. The "busiest hour", 6 pm, has 101 aircraft only because it is the only full hour recorded.
- **Ground rows have no altitude.** All 312 rows with no altitude are rows where the aircraft was on the ground, and every on-ground row has no altitude.
- **Routes are the most-missing field.** 111 of 193 aircraft (58%) never had a route. Aircraft with N-number callsigns almost never did (39 of 43).
- **Some airborne altitudes are zero or below.** 76 airborne rows from 26 aircraft are at or below 0 ft (minimum −400 ft). Most are small aircraft (Cessna 172, Robinson R44).
- **Updates came every 30 seconds** almost every time.

**Inferences** (labelled; not proven by this file):

- **Private flights.** This suggests routes are missing mainly because private flights do not publish a schedule. We did not check the route provider's coverage.
- **Below-zero altitudes.** This suggests they come from barometric altitude being measured against standard pressure, so low-flying aircraft can read slightly below zero. We have no weather or pressure data to confirm it.

**Not proven:**

- Anything outside the 25 nm circle or outside these two hours.
- Anything about aircraft that do not broadcast.
- Whether one evening is typical.
- Whether a 5-second update would show anything the 30-second snapshots miss.

## 7. Recommendation

Because 58% of aircraft (111 of 193) never had a route, and private aircraft almost never do, we recommend that the flight list and detail panel replace "— → —" with "Route not published", explained in the detail panel. That way users understand the route is missing from the source, not broken in our app.

We would check it by asking three testers what a missing route means before and after the change, and by confirming that the share of aircraft shown with that label matches the missing-route rate above.
