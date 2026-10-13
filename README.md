# Flight Tracker — Student Starter

Welcome! In this project you will build a **Flight Tracker** web page using only **HTML, CSS and JavaScript**. No build step, no libraries, no data source.

This branch (`v1-uxbridge`) is your **starting point**. The HTML, CSS and JavaScript files contain numbered steps that tell you **what to write, where it goes, and why**. The finished version lives on the **`v1-final`** branch. Use it as a reference when you are stuck, not as something to copy and paste.

| Language | Job | File |
|---|---|---|
| HTML | Structure: what is on the screen | `index.html` |
| CSS | Presentation: how it looks | `css/styles.css` |
| JavaScript | Behavior: what happens on a click or keystroke | `js/app.js` |

## What you are building

A black-and-white wireframe of a flight tracker:

- A header with a title and a connection status
- A left panel with search, origin/destination filters and a list of flights
- A detail panel that opens when you pick a flight
- A placeholder map with an aircraft marker for each flight

Open `v1-final` (see below) to see and try the finished result before you start.

## Get started in GitHub Codespaces

You do not need to install anything. Codespaces gives you VS Code in your browser.

1. Open the repository on GitHub.
2. Use the branch menu (top left of the file list) and select **`v1-uxbridge`**.
3. Click the green **Code** button, open the **Codespaces** tab, and click **Create codespace on v1-uxbridge**.
4. Wait for the editor to load. When it asks to install the recommended **Live Server** extension, click **Install**.

> Tip: Codespaces gives you a limited number of free hours. Stop your codespace when you are done (bottom-left corner → **Stop Current Codespace**), and come back to it from [github.com/codespaces](https://github.com/codespaces).

## View your changes (Live Preview)

1. In the Explorer on the left, open `index.html`.
2. Click **Go Live** at the bottom-right of the window (or right-click `index.html` → **Open with Live Server**).
3. Codespaces opens the page in a new browser tab. A **Ports** tab at the bottom also lists it (port 5500). Click the globe icon next to it to open the page again.
4. Edit a file and **save** (Ctrl+S, or Cmd+S on a Mac). The page reloads by itself and shows your change.

No Live Server? Run this in the Codespaces terminal, then open the pop-up that appears for port 8000:

```
python3 -m http.server 8000
```

If something does not work, open the browser's developer tools (F12) and look at the **Console** tab for error messages.

## How to work

Do the work in this order. Do one step at a time, save, and check the browser before moving on.

1. **`index.html`**: follow STEP 1 to STEP 6. You will see plain, unstyled content. That is correct.
2. **`css/styles.css`**: follow STEP 1 to STEP 9. Your plain content turns into a layout.
3. **`js/app.js`**: follow STEP 1 to STEP 7. Your page now responds to clicks and typing.

Each step in the files explains:

- **WHY**: the reason for the step
- **YOUR CODE**: what you need to write

## Compare your work with `v1-final`

The finished project is on the `v1-final` branch. You have three ways to look at it.

**1. On GitHub (easiest).** Use the branch menu to switch to `v1-final`, and open the file you want to compare. To see it next to your own work, open the same file in two browser tabs.

**2. See exactly what is different.** In the Codespaces terminal:

```
git fetch origin v1-final
git diff v1-uxbridge origin/v1-final -- index.html
```

Replace `index.html` with `css/styles.css` or `js/app.js` for the other files. Lines starting with `+` are in the finished version; lines starting with `-` are in the starter.

**3. Run the finished version side by side.** Open a second codespace on `v1-final` (repeat the Codespaces steps above and choose `v1-final`), and keep both windows open.

To look at a single finished file without switching branches:

```
git show origin/v1-final:js/app.js
```

> Do not switch branches while you have unsaved or uncommitted work. Save and commit first (see below), or open the finished version in a second codespace.

## Save your work

Commit often. Small commits make it easy to go back if something breaks.

```
git add .
git commit -m "Add the header and sidebar markup"
git push
```

Or use the **Source Control** icon in the left sidebar: type a message, click **Commit**, then **Sync Changes**.

## Folder layout

```
flight-tracker/
  index.html        markup for the whole screen (follow the steps inside)
  css/
    styles.css      one stylesheet (follow the steps inside)
  js/
    app.js          state, update functions, event listeners (follow the steps inside)
  README.md         this file
```

## The pattern behind `js/app.js`

1. **State**: one `state` object remembers what is going on (which flight is selected, what is typed in search, and so on).
2. **Update functions**: small functions change the page to match the state.
3. **Event listeners**: each click or keystroke calls one of those functions.

Flight details are read from `data-*` attributes on each list button in `index.html` (for example `data-origin="BOS"`). All values are **hard-coded placeholders**, such as tail numbers, times and speeds.

## Decisions already made for the wireframe

- **Black and white only.** Color comes later when real styling starts.
- **Hide in the list, dim on the map.** When a search or filter does not match a flight, it disappears from the list but stays faded on the map, so the user keeps their context.
- **Map is a placeholder.** Airports and aircraft sit in positions that loosely follow US geography. They are not to scale.
- **Missing values** show "Not available" instead of a blank.
- **Accessibility basics:** use real `<button>` elements, labels on inputs, and keyboard focus outlines.

## Not included on purpose

No data source, no simulated flight movement, no real map, no chart, no build tools, no framework. Those arrive in later weeks.
