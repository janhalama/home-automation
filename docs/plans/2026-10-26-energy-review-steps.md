# Energy review, in steps

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement one step at a time. Do not start the next step in the same session. Step 1 already has a task-by-task plan.

**Goal:** A page on the NAS, next to the home-automation API, that says whether the house bought electricity in cheap intervals, sold it in expensive ones, kept the battery above its floor, and exported PV when tomorrow's sun already covered the night.

**Architecture:** The page only reads. Loxone keeps running the house. The API stores three series in the SQLite file it already mounts at `/data`: OTE day-ahead prices, tank heating periods copied from the Miniserver, and the Wattsonic day curves already on disk. Scores are pure functions over one day. The advisor that writes a plan back to Loxone is not part of these steps.

**Tech Stack:** The existing Fastify API, Node's built-in SQLite, Vitest, OTE's public day-ahead service, the Miniserver HTTP API.

---

## What is already decided

- The dashboard sits in the API process on the NAS. Loxone keeps the live controls.
- Spot prices come from OTE, the market behind `https://www.ote-cr.cz/en`. Loxone's block `Optimalizátor spotových cen` downloads that same market and shows it as `Aktuální spotová cena` in Kč/kWh. The API stores OTE's 15-minute day-ahead prices. One stored interval is compared with that Loxone value so the page uses the Kč/kWh the house acted on.
- Tank periods come from the Miniserver. `Nabíjení bojleru zapnuto` is the heater. `TUV charging tracking` keeps only the last 10 periods, so the API copies each one into SQLite. The boiler temperature at both ends is `Aktuální teplota bojleru`.
- The seasonal table in ADR 0008 is how "exported when that was wise" is judged. A morning was worth exporting when that day's expected PV was at least the overnight figure for the season. The single 20 kWh line is retired.
- The Wattsonic download can still be running. Each step reads files already on disk.

## What these steps do not do

They do not choose a cheap slot, write a wallbox permission, or change the Wattsonic. They do not move the upper tank sensor. They do not take evcc down.

---

### Step 1. Seasonal table in the API

The API can answer how many kWh the battery above the floor still needs. The car’s slot is the one that finishes before 6 a.m. The battery’s slot is the cheapest period long enough for that energy, including a daytime period on a weekend or a bank holiday.

**Plan:** `docs/plans/2026-10-26-seasonal-house-buy.md`

**Done when:** `overnightKwh`, `expectedPvKwh`, `cloudBand`, and `houseGridKwh` pass their tests. Nothing is deployed.

**Out:** prices, the tank, the page.

### Step 2. OTE price archive

The API stores the 15-minute day-ahead price for each interval, for the days that already have a Wattsonic curve, and for each new day after that.

**Files:** a client under `apps/home-automation-api/src/services/`, a table in the same SQLite file as `forecast_days`, a test with a saved OTE response.

**Done when:** a test loads one fixture day and reads back the interval prices. A second check records the conversion that makes one interval match `Aktuální spotová cena`. The token and the Loxone password stay in `.env`.

**Out:** the tank, the scores, the page. No scrape of the HTML site. The public day-ahead service is the source.

### Step 3. Tank periods

The API copies heater periods from the Miniserver into SQLite: start, end, temperature at the start, temperature at the end.

**Done when:** a period that appears on `TUV charging tracking` is still in the database after the tracker has dropped it. Periods from before this step do not exist, and the page will say so.

**Out:** judging whether the period was cheap. That is step 4.

### Step 4. A score for one day

Four numbers for a date, from the Wattsonic curve, that day's OTE prices, and the seasonal table. No page yet.

- **Bought cheaply.** The import-weighted price against the day's median price.
- **Sold expensively.** The export-weighted price against the day's median price.
- **Battery stayed safe.** Minutes where the state of charge was under 20%, and the lowest state of charge.
- **PV export was wise.** Morning export against morning battery charging, judged by ADR 0008: expected PV for that season and that morning's low cloud, compared with the overnight figure.

The tank line is the periods from step 3 that overlap the cheap half of the day. Days with no stored periods say the tank history has not started.

**Done when:** tests on one clear summer day and one covered winter day return those four results from fixtures. A missing price series fails the score instead of inventing a price.

### Step 5. The page

One page served by the API on the NAS, on the same port as the prediction route. It shows the last week and one chosen day, with the four scores and the tank line.

**Done when:** a day that step 4 can score is visible in a browser on the LAN. A day with no OTE prices shows that the price is missing.

**Out:** editing setpoints. The page does not write to Loxone.

### Step 6. Forecast deviation on the same page

The learning store already saves an issued forecast and, once Loxone sends it, yesterday's production. The page shows the signed mean of actual minus forecast, and the mean absolute deviation, overall and per cloud band.

**Done when:** the page shows those two figures after at least one stored pair. Before that it shows that no pair has been recorded. Today is still not corrected. Tomorrow is still corrected only after five similar days, which is the rule already in the API.

**Out:** wiring input I2 on the Miniserver. That is a separate visit to Loxone Config. Until it is wired, this block stays empty.

---

## After these six

The advisor that writes the cheapest slot, the wallbox permission, and the battery command is a later plan. It uses the seasonal table, the OTE series, and the tank periods. It waits until the page has been looked at on real days.
