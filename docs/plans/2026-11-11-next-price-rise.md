# Charge before the next price rise — implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** The single battery buy finishes before the next rise of 2 Kč/kWh, and the following poll books another buy before the rise after that, including Thursday evening before Friday morning.

**Architecture:** A pure walk finds the next rise on the quarters still ahead, including tomorrow through late morning. The existing cheapest-run search gains an end clock on the far side of midnight. `buildEnergyPlan` sizes the buy for that rise and refuses quarters inside it. Loxone's one `batteryFrom` / `batteryTo` pair is unchanged. Design: `docs/plans/2026-11-11-next-price-rise-design.md`.

**Tech Stack:** TypeScript, Vitest, the energy plan in `apps/home-automation-api`.

---

### Task 1: The next rise

**Files:**
- Create: `apps/home-automation-api/src/services/price-rise.ts`
- Test: `apps/home-automation-api/test/price-rise.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { nextPriceRise } from "../src/services/price-rise.js";

describe("next price rise", () => {
  it("starts where the price climbs 2 Kč above the trough ahead", () => {
    const rise = nextPriceRise([
      { periodInterval: "03:00-03:15", eurPerMwh: 185 },
      { periodInterval: "06:15-06:30", eurPerMwh: 230 },
      { periodInterval: "06:30-06:45", eurPerMwh: 276 },
      { periodInterval: "09:00-09:15", eurPerMwh: 375 },
      { periodInterval: "19:30-19:45", eurPerMwh: 243 },
      { periodInterval: "23:45-24:00", eurPerMwh: 145 }
    ]);
    expect(rise).toEqual({ from: "06:30", to: "19:30" });
  });

  it("returns the following rise once the first one has ended", () => {
    const rise = nextPriceRise([
      { periodInterval: "21:00-21:15", eurPerMwh: 160 },
      { periodInterval: "23:45-24:00", eurPerMwh: 145 },
      { periodInterval: "06:30-06:45", eurPerMwh: 280 },
      { periodInterval: "09:00-09:15", eurPerMwh: 360 }
    ]);
    expect(rise).toEqual({ from: "06:30", to: null });
  });

  it("returns null when nothing ahead clears 2 Kč", () => {
    expect(nextPriceRise([
      { periodInterval: "02:00-02:15", eurPerMwh: 100 },
      { periodInterval: "18:00-18:15", eurPerMwh: 170 }
    ])).toBeNull();
  });
});
```

100 EUR/MWh is 2.5 Kč/kWh, so 80 EUR/MWh is 2 Kč. The walk uses that gap. A quarter that only continues a rise is not a new trough.

**Step 2: Run the test and confirm it fails**

Run: `pnpm --filter home-automation-api test -- test/price-rise.test.ts`

Expected: FAIL, `nextPriceRise` is not defined.

**Step 3: Implement**

```typescript
import { czkPerKwh } from "./ote-day-ahead.js";

const GAP_CZK = 2;
const CZK_PER_EUR = 25;

export type RiseQuarter = { periodInterval: string; eurPerMwh: number };

export type PriceRise = { from: string; to: string | null };

function priceCzk(eurPerMwh: number): number {
  return czkPerKwh(eurPerMwh, CZK_PER_EUR);
}

function startClock(periodInterval: string): string {
  return periodInterval.split("-")[0];
}

/* First climb of more than 2 Kč above the trough still ahead. to is the quarter where it falls back, or null when the list ends inside the rise. */
export function nextPriceRise(quarters: RiseQuarter[]): PriceRise | null {
  let index = 0;
  while (index < quarters.length) {
    let trough = quarters[index].eurPerMwh;
    let cursor = index;
    while (cursor < quarters.length && priceCzk(quarters[cursor].eurPerMwh) - priceCzk(trough) <= GAP_CZK) {
      trough = Math.min(trough, quarters[cursor].eurPerMwh);
      cursor += 1;
    }
    if (cursor >= quarters.length)
      return null;
    const from = startClock(quarters[cursor].periodInterval);
    while (cursor < quarters.length && priceCzk(quarters[cursor].eurPerMwh) - priceCzk(trough) > GAP_CZK)
      cursor += 1;
    return { from, to: cursor < quarters.length ? startClock(quarters[cursor].periodInterval) : null };
  }
  return null;
}
```

The second test's quarters are one list in time order, with the morning clocks after midnight. The caller joins the days before this function sees them. This function does not know dates.

**Step 4: Run the test and confirm it passes**

Run: `pnpm --filter home-automation-api test -- test/price-rise.test.ts`

Expected: PASS, 3 tests.

### Task 2: A buy may end at tomorrow's rise

**Files:**
- Modify: `apps/home-automation-api/src/services/cheap-slot.ts`
- Test: `apps/home-automation-api/test/cheap-slot.test.ts`

`cheapestSlotAcrossMidnight` always stops at 06:00. The battery needs the same join of 24:00 to 00:00, with the stop clock chosen by the caller. Leave the 06:00 function in place for the tank and the car.

**Step 1: Write the failing test**

A 1 kWh job at 2.5 kW is one quarter. Today 23:00–23:15 is 200 EUR. Tomorrow 05:45–06:00 is 100 EUR. Tomorrow 06:30–06:45 is 50 EUR and is the rise, so the stop is 06:30. The winner is 05:45–06:00. The 06:30 quarter is not eligible.

**Step 2: Run that test and confirm it fails**

Run: `pnpm --filter home-automation-api test -- test/cheap-slot.test.ts`

Expected: FAIL.

**Step 3: Implement**

Add `cheapestSlotUntil(before, after, kwh, powerKw, startAt, endAt)` beside `cheapestSlotAcrossMidnight`. `endAt` is a clock on the tomorrow side. Include a tomorrow quarter only when its end minute is at or before `24:00 + endAt`. Today quarters still have to end after `startAt`. The cheapest contiguous run is the one `cheapestRun` already returns.

`cheapestSlotAcrossMidnight` becomes a call with `endAt` of `06:00`.

**Step 4: Run the test and confirm it passes**

Run: `pnpm --filter home-automation-api test -- test/cheap-slot.test.ts`

Expected: PASS, including the existing midnight tests.

### Task 3: The battery buy stops at the rise

**Files:**
- Modify: `apps/home-automation-api/src/services/energy-plan.ts`
- Test: `apps/home-automation-api/test/energy-plan.test.ts`

The working copy charges before the single highest quarter. Replace that placement. The amount stays the larger of the house shortfall and the room the sun will not fill, and both are measured on the rise rather than on the whole day.

**Step 1: Write the failing tests**

Use `buildEnergyPlan` in `test/energy-plan.test.ts`. Pass `nightHouseKwh` and `daylightHouseKwh` explicitly, as the house-shortfall tests already do.

Thursday shape, clock 22:45, tomorrow's prices attached:

- Tonight 22:45–23:00 at 250 EUR, then 23:00–06:15 in 15-minute steps at 190 EUR, except 03:00–03:15 at 160 EUR.
- Tomorrow 06:30–19:30 at 360 EUR, one quarter per hour is enough if the walk only needs the ends. Include 06:15–06:30 at 200, 06:30–06:45 at 280, 09:00–09:15 at 375, 19:30–19:45 at 220, 23:45–24:00 at 145.
- `startAt` `"22:45"`, `socPercent` 20, `aboveFloorKwh` 0, `pvRemainingKwh` 0, `tomorrowPvKwh` 4.6, tank at 55°C, car missing 0, season autumn, date `"2026-11-11"`.
- House load: `nightHouseKwh` 8, `daylightHouseKwh` 8.

Expect `battery` `grid-charge`, `batteryTo` at or before `"06:30"`, and `batteryFrom` after `"22:45"`. Expect the slot to contain 03:00. Expect `batteryTo` not to be `"24:00"`.

Second call, same prices, `startAt` `"20:00"` on date `"2026-11-12"`, with Friday's morning attached as `tomorrowPrices`: 00:00–06:15 at 190, 06:30–06:45 at 280, 09:00–09:15 at 370. `socPercent` 30, `aboveFloorKwh` 1.9, `pvRemainingKwh` 0.

Expect a charge with `batteryFrom` at or after `"20:00"` and `batteryTo` at or before `"06:30"`. That is the same-day evening buy before the next morning's rise.

Third case: `startAt` `"10:00"` inside the 360 EUR stretch, no tomorrow prices. Expect `battery` `"hold"`.

**Step 2: Run the tests and confirm they fail**

Run: `pnpm --filter home-automation-api test -- test/energy-plan.test.ts`

Expected: FAIL on the new cases. The 19:45–24:00 placement, or a buy that runs through the expensive morning, is the failure.

**Step 3: Implement**

In `buildEnergyPlan`, build the ahead list: today's quarters that end after `startAt`, then tomorrow's quarters through 12:00 when `tomorrowPrices` is present. Feed that list to `nextPriceRise`.

When a rise exists:

- House energy is `expensiveHouseKwh` restricted to quarters from `rise.from` until `rise.to`. A null `to` means through the end of the ahead list. Subtract `aboveFloorKwh` and the share of `pvRemainingKwh` plus `tomorrowPvKwh` whose daylight falls inside the rise. Floor at zero.
- Room the sun will not fill uses the same sun share, and only when the rise high is at least 3 Kč above the trough. The trough is the cheapest ahead quarter before `rise.from`.
- The buy is the larger of those two, capped by `roomToFullKwh`.
- The slot ends at `rise.from`. When `rise.from` is tomorrow, or it is earlier than `startAt` on the clock, call `cheapestSlotUntil` with that end clock. Otherwise call `cheapestSlot` with `endBy` set to `rise.from`.
- Power is 3 kW, then 2.5 kW when the chosen slot overlaps both the tank window and the car window.

When no rise exists, keep today's cheapest-block buy.

Leave `batterySellFrom` / `batterySellTo` on the dearest quarter. Do not move the sale to the rise.

Update `charges before the peak at full power` if its buy now ends at the first expensive quarter rather than at 07:30. The sale at 17:15 stays.

**Step 4: Run the tests and confirm they pass**

Run: `pnpm --filter home-automation-api test -- test/energy-plan.test.ts test/cheap-slot.test.ts test/price-rise.test.ts`

Expected: PASS.

### Task 4: The file header

**Files:**
- Modify: `apps/home-automation-api/src/services/energy-plan.ts` (the comment at the top)

Replace the sentence that says the buy waits for the cheaper hour through the next 06:00. State that a buy finishes before the next rise of 2 Kč/kWh, and that the poll after the rise books the next one, including the cheap evening before the following morning.

Run the same three test files once more.
