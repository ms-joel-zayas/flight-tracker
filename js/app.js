/* =====================================================================
   FLIGHT TRACKER — STARTER (JavaScript = behavior)
   JavaScript decides WHAT HAPPENS when someone clicks, types or picks
   something. It does not hold the page structure (HTML) or the look (CSS).

   There is no data source yet. Each flight's details are read from the
   data-* attributes you add to each flight button in index.html.

   Build this file in the order below. Test in the browser after each step
   (open the browser console to see errors and console.log messages).
   Compare with the v1-final branch if you get stuck.

   The pattern you are learning:
     1. State    — one object that remembers what is going on
     2. Update   — small functions that change the page to match the state
     3. Listen   — event listeners that call those functions
   ===================================================================== */


/* ---------- STEP 1. Grab the pieces of the page ----------
   WHY: JavaScript can only change what it can find. Look elements up once
   at the top, save them in variables, and reuse them everywhere below.
   YOUR CODE:
   - Two shortcuts so you type less:
       const $  = (selector) => document.querySelector(selector);
       const $$ = (selector) => Array.from(document.querySelectorAll(selector));
   - Variables for the search input, the two selects, the empty message,
     the aircraft count badge and the detail panel (use the ids from your HTML).
   - Lists of all flight buttons (.flight-row) and all map markers (.marker).
   Check: console.log(flightRows.length) should print how many flights you added. */


/* ---------- STEP 2. State ----------
   WHY: If the page's "memory" is spread across many elements it gets
   confusing. Keeping it in ONE object means you always know where to look.
   YOUR CODE: a const state = { ... } with fields such as
   selectedId (null at first), search (""), origin ("") and dest ("").     */


/* ---------- STEP 3. Select a flight ----------
   WHY: Clicking a flight in the list OR on the map should do the same thing,
   so write it once as a function and call it from both places.
   YOUR CODE: function selectFlight(id) that:
     a) saves id in state.selectedId
     b) sets aria-pressed to "true" on the matching list button and map
        marker, and "false" on all the others (your CSS already styles this)
     c) copies that flight's data-* values into the detail panel
        (row.dataset.origin gives you the value of data-origin) using
        element.textContent
     d) un-hides the detail panel (panel.hidden = false)                    */


/* ---------- STEP 4. Close the detail panel ----------
   WHY: Users need a way to get back. Clearing the state and the page
   together keeps them in sync.
   YOUR CODE: function closeDetail() that sets state.selectedId to null,
   sets every aria-pressed back to "false", and hides the panel again.     */


/* ---------- STEP 5. Search and filters ----------
   WHY: Users find a flight faster by typing than by scanning.
   YOUR CODE:
   - function flightMatches(row): returns true if the row's data matches the
     search text AND the selected origin AND the selected destination.
     Tip: make search forgiving by lowercasing and removing spaces, so
     "ac 2210" finds "AC 2210".
   - function renderFlights(): for each flight, show or hide its list item
     (parent.hidden = true/false), dim the matching map marker
     (classList.toggle("is-dimmed", ...)), then update the count badge and
     show the empty message if nothing matched.
   Why hide in the list but only dim on the map? Hiding map markers would
   make users think the aircraft left; dimming keeps the context.          */


/* ---------- STEP 6. Event listeners ----------
   WHY: This is what connects the user's actions to your functions.
   Nothing runs until something calls it.
   YOUR CODE (use addEventListener):
   - "click" on every flight button and every marker -> selectFlight(id)
   - "click" on the close button -> closeDetail
   - "input" on the search box -> save the text in state.search, then renderFlights()
   - "change" on each select -> save the value in state, then renderFlights()
   - "keydown" on the document: if event.key is "Escape", close the detail panel. */


/* ---------- STEP 7. Start-up ----------
   WHY: Decide what the page looks like the moment it loads.
   YOUR CODE: call renderFlights() once, and optionally selectFlight(...)
   with one flight id so the page opens with something selected.           */


/* ---------- STRETCH GOALS (after everything above works) ----------
   Try these one at a time, and compare with v1-final for ideas:
   - A button that slides the sidebar closed and open
   - A status pill that can switch between LIVE and STALE
   - Show the empty-state message when filters match nothing
   - A "Not available" message when a flight is missing a value           */
