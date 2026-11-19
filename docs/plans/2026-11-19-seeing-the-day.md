# Seeing the day Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Hours that have started keep the decision that was in force, a later decision changes only hours that have not started, and the day page shows that plan, why the future part changed, and the measured flows on one clock.

**Architecture:** The planner still proposes. The plan route merges that proposal with what is already stored: a tank window, a car window, or a battery charge that has started stays until it ends, and only the hours still ahead are replaced. When that future part changes, one line is stored, naming the single input that changed. The page reads the store. It does not paint past hours from a fresh calculation. ADR 0015 remains the battery-charge case. ADR 0016 and ADR 0017 are the source. The follower program is not changed.

**Tech Stack:** TypeScript, Vitest, Fastify, the existing SQLite house archive, Chart.js in `apps/energy-view`.

---

### Task 1: Store the issued decision and the change lines

**Files:**
- Modify: `apps/home-automation-api/src/services/house-archive.ts`
- Test: `apps/home-automation-api/test/house-archive.test.ts`

Add two tables beside `battery_charge_windows`.

`day_decisions` stores one segment of a decision that was issued: `date`, `kind` (`tank`, `car`, `battery-buy`, `battery-sell`, `battery-wait`), `from_clock`, `to_clock`, `kw`, `mode` (`grid`, `battery`, `surplus`, or empty). A battery buy keeps its `kw`. A car segment keeps `mode`. List and replace are by date. Replace writes the whole set for that date.

`plan_changes` stores one line: `date`, `at` (`HH:MM`), `trigger`, `result`. List returns newest first. Append does not delete older lines.

`plan_change_segments` stores the plan as it stood when that line was written. The columns match `day_decisions`, plus the change they belong to. The set is the merged decision after the change, the whole day, not only the hours that moved.

A day with no rows lists as empty. That is a day from before this store.

Run: `pnpm --filter home-automation-api test -- test/house-archive.test.ts`

### Task 2: Keep hours that have started, and replace only the future

**Files:**
- Create: `apps/home-automation-api/src/services/day-decision.ts`
- Test: `apps/home-automation-api/test/day-decision.test.ts`

`mergeDecision(stored, proposed, now)` returns the segments to save.

- A segment whose start is before `now` stays, through its end. This covers a tank window, a car window, and a battery buy. ADR 0015's booked battery charge is the battery-buy case already stored; this merge must not drop it while `now` is inside it.
- A segment that starts at or after `now` is dropped and replaced by the proposal's future segments.
- A proposal that repeats the same future segments leaves the stored future as it is.
- While a kept tank or car segment is on and no battery buy covers that same minute, the merge adds `battery-wait` for the overlap. The wait is not read from the inverter.
- Hours with no buy, no sale, and no wait are not stored. The page will draw those as the battery running the house.

Tests: at 10:00 a tank window 08:00–12:00 stays even when the proposal says the tank is off. A tank window 20:00–23:00 is replaced by the proposal. A battery buy 00:00–02:15 stays when `now` is 01:00. A car window 09:00–11:00 with no battery buy produces `battery-wait` for 09:00–11:00.

Run: `pnpm --filter home-automation-api test -- test/day-decision.test.ts`

### Task 3: Name one trigger when the future part changes

**Files:**
- Modify: `apps/home-automation-api/src/services/day-decision.ts`
- Test: `apps/home-automation-api/test/day-decision.test.ts`

`futureChange(before, after, previousInputs, nextInputs, now)` returns one line or null.

No line when the future segments are the same. No line when only the clock moved and the future segments did not change.

When they differ, the trigger is the first input in this order that is different:

1. Booked charge ended
2. The clock
3. Today's prices
4. Tomorrow's prices arrived
5. Tank fell below 55°C, or Tank reached 55°C
6. Car plugged in, or Car no longer needs a charge
7. Night charging turned off, or Night charging turned on
8. Battery state of charge
9. Expected sun
10. Recent house use
11. Season

The result sentence is the future part that changed, in one sentence: the tank hours, the car mode and hours, or the battery buy or sale hours. The line also carries the merged segments for the whole day, which is the snapshot. The same future part does not add a second line.

Tests: identical future returns null. A new car slot with only `atHome` flipping to true is `Car plugged in`. A tank crossing 55°C upward is `Tank reached 55°C`. Two inputs changing at once names only the earlier one in the list.

Run: `pnpm --filter home-automation-api test -- test/day-decision.test.ts`

### Task 4: The live plan route keeps the past and writes the line

**Files:**
- Modify: `apps/home-automation-api/src/routes/energy-plan.route.ts`
- Test: `apps/home-automation-api/test/energy-plan.route.test.ts`

On a look at Prague today, the route still builds the proposal, then merges it with the stored decision and saves the result. It appends a line only when `futureChange` returns one. The text sent to the Miniserver is that merged decision, so a window that has started stays in `tankFrom`/`tankTo`, `carFrom`/`carTo`, and `batteryCharges` until it ends.

A look at any other day, and `asOf=open`, does not write. It returns the stored decision for that date when one exists. When none exists, it returns the fresh calculation, as today.

The response gains `planChanges`, newest first, one line `HH:MM trigger | result`.

The follower files under `src/loxone` are not edited.

Test: a second poll in the same hour, with the same inputs, does not add a line and does not move a tank window that started at 08:00. A poll after that window's end, with the tank now at 55°C, keeps 08:00 through the old end and writes one line `Tank reached 55°C`.

Run: `pnpm --filter home-automation-api test -- test/energy-plan.route.test.ts`

### Task 5: The plan bar

**Files:**
- Create: `apps/energy-view/src/scripts/plan-bar.ts`
- Test: `apps/energy-view/src/scripts/plan-bar.test.ts`
- Modify: `apps/energy-view/src/scripts/dashboard.ts`

Three lanes on one clock: Tank, Car, Battery. Draw them from the stored segments, not from a fresh plan.

A segment that has started is solid. A segment that has not started is hatched. Battery buy is green. Battery sale is red. Battery wait is the pale gray. Hours with none of those are the battery running the house, hatched when still ahead and solid when the hour has started. Car from the grid and car from the battery are the same car lane, with the mode in the label.

When the selected day is today, a thin red line crosses the lanes at Prague now, with `HH:MM` above the line. Another day has no line.

Run the energy-view tests from the API package: `pnpm --filter home-automation-api exec vitest --root ../energy-view --run src/scripts/plan-bar.test.ts`

### Task 6: The power chart

**Files:**
- Modify: `apps/energy-view/src/scripts/day-rows.ts`
- Test: `apps/energy-view/src/scripts/battery-plan-series.test.ts`

Replace the separate plan and measured rows for the tank, the car, and the battery with one stack. Keep the price row, the sun rows, and the tank temperature row above it.

Order, each row on its own scale, with the same soft grid the page already draws:

1. Grid. Import below zero stays red.
2. Tank plan, hatched, from the stored tank segments.
3. Tank heating, solid, from the heater.
4. Car plan, hatched, from the stored car segments.
5. Car charging, solid, from the measured car.
6. Battery plan, hatched. Buy below zero in green. Sale above zero in red.
7. Battery power, solid. Buy below zero in green. The house above zero in orange. A sale above zero in red.

The plan rows and the measured rows share the clock with the plan bar. A day with no stored decision leaves the plan rows empty. It does not invent them from a fresh calculation.

Run: `pnpm --filter home-automation-api exec vitest --root ../energy-view --run src/scripts/battery-plan-series.test.ts`

### Task 7: Heater time outside the stored tank hours

**Files:**
- Modify: `apps/energy-view/src/scripts/day-rows.ts`
- Test: `apps/energy-view/src/scripts/battery-plan-series.test.ts`

On the tank heating row, minutes inside a stored tank segment stay with the plan. Minutes outside it use the other color. When any minute is outside, the row title says the house heated then. The page does not name a switch.

A day with no stored tank decision draws the heater as one series, with no claim about the house acting.

Run: `pnpm --filter home-automation-api exec vitest --root ../energy-view --run src/scripts/battery-plan-series.test.ts`

### Task 8: The change lines on the day

**Files:**
- Modify: `apps/energy-view/src/scripts/dashboard.ts`
- Modify: `apps/energy-view/src/pages` (the day section that already holds the plan sentence)

Under the plan bar, list `planChanges` newest first. Each line is the time, the trigger, and the result. No prefix in front of the trigger. The snapshot is not drawn on the page. Choosing a line opens it over the day, and dismissing it closes it. The picture uses the same three lanes as the plan bar: solid where that hour had already started at `at`, hatched where it was still ahead, and a thin red line at `at` with the time above it. The snapshot is the plan only. No summary figures above the plan.

A day with no lines shows nothing in that spot.

Run: `pnpm --filter home-automation-api test`

---

Do not deploy and do not edit `src/loxone` as part of this plan. A day before the store exists has no past plan and no change lines. The measured car, tank, battery, grid, and house series stay the series the page already reads.
