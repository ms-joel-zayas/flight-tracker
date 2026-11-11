# Sample Dependency Risk Log (mentor reference, Week 9)

This is one possible answer for the Week 9 Challenge: document one dependency risk or assumption. Students write their own from what they read and what they saw, then compare. It is a reference, not an answer key to copy.

A **dependency** is anything our app needs that we did not write and do not control. This app has two main ones: the **Leaflet library** (installed with npm) and the **OpenStreetMap tiles** (the map's background pictures, downloaded while the page runs). Every row below is an assumption we made. A risk log says what we assumed, how we would find out it was wrong, and what we do about it.

| Dependency | Assumption or risk | How we check | What we do |
|---|---|---|---|
| Leaflet 1.9.4 | The docs we read match the version we run. Leaflet 2.0 is still pre-release and may change how the library is loaded and used, so "latest" docs or an AI answer may not match 1.9.4. | `npm ls leaflet` shows the installed version; the version drop-down on leafletjs.com shows which docs you are reading; `package.json` has `"leaflet": "1.9.4"` with no `^`. | Pin the exact version. Upgrade on purpose, on a new branch, and re-run the test page. |
| OpenStreetMap tiles | Tiles need an internet connection. With no network the map background is empty. | Turn off Wi-Fi and reload: a note appears and the aircraft are still drawn at their lat/lon. | Keep the `tileerror` note. Say in the presentation that the demo needs internet. |
| OpenStreetMap tile policy | The public tile servers have a usage policy: the credit line is required, and heavy or commercial use is not allowed. | Read https://operations.osmfoundation.org/policies/tiles/ ; check the credit line is visible above the replay bar. | Fine for a school project. Before real users, switch to a hosted tile service or one we run. |
| Latitude and longitude order | Leaflet takes `[lat, lon]`. Some tools (GeoJSON) take `[lon, lat]`. Swapped values draw the aircraft in the wrong place. | `locationProblem()` in `js/quality.js` warns when a number is out of range. A swap that stays in range (Boston) is only visible on the map, so look at the map too. | Name the fields `lat` and `lon`, convert in one function (`toLatLng`), and test it. |
| Placeholder positions | `data.json` positions are straight-line placeholders. Real flights follow curved paths and the map will show that gap. | Compare a trail with a real route for the same airports. | Keep the note in `meta.notes`. Do not describe the trails as real routes. |
| Jest 30.5.2 (dev only) | A tool we use only to run tests. It is a `devDependency`, so the page never loads it. `npm audit` reports an advisory in `deepmerge`, a package that Jest itself depends on (a dependency of a dependency). | Run `npm audit` and read the advisory. Check that `jest` is under `devDependencies` and that no `<script>` in `index.html` loads it. | Accept the risk for a school project: it runs only on a developer's machine, on our own files. Do not follow `npm audit fix --force`, which would install Jest 25 and break the tests. Re-check when Jest releases an update. |
| npm install | `node_modules/` is not saved in git, so a fresh clone has no Leaflet until someone runs `npm install`. | Clone into a new folder and open the page: it says "Could not load Leaflet". | Put `npm install` first in the README. Commit `package.json` and `package-lock.json`. |

## What was tested, not guessed

Every "How we check" above was done in a browser or with a command, not assumed. When an AI answer and the Leaflet docs disagree, the docs and the working page decide.
