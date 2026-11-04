# Car plan follows Home Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** The live plan sizes Obluda's slot from the latest missing energy while the car is inside the Home geofence, and leaves the car line off when it is anywhere else.

**Architecture:** TeslaMate MQTT gains the geofence name as a yes-or-no. The cheapest-slot search can cross midnight up to the next 06:00 and ignores quarters that have already ended. The plan route applies that car only to Prague today. The dashboard reloads today once an hour.

**Tech Stack:** TypeScript, Vitest, Fastify, the existing MQTT reader, the energy-view page.

---

### Task 1: Home is a yes or no on the car reading

**Files:**
- Modify: `apps/home-automation-api/src/services/car-energy.ts`
- Modify: `apps/home-automation-api/src/services/teslamate-car.ts`
- Test: `apps/home-automation-api/test/teslamate-car.test.ts`
- Test: `apps/home-automation-api/test/car-energy.test.ts`

Add `atHome: boolean` to `CarReading`. Subscribe to `teslamate/cars/1/geofence` beside the three topics already used. The payload `Home` sets `atHome` true. An empty payload and any other name set it false. A missing geofence topic throws the same way a missing charge topic throws.

The subscribe packet and `carReadingFromMessages` must not mention `latitude` or `longitude`. Extend the existing decode test: payload `Home` is at home, payload `""` is not, payload `Work` is not.

Run: `pnpm --filter home-automation-api test -- test/teslamate-car.test.ts test/car-energy.test.ts`

### Task 2: A slot may cross midnight and must still be ahead

**Files:**
- Modify: `apps/home-automation-api/src/services/cheap-slot.ts`
- Test: `apps/home-automation-api/test/cheap-slot.test.ts`

`cheapestSlot` takes an optional `startAt` clock. A quarter whose end is at or before `startAt` is dropped. `endBy` stays "drop a quarter whose end is after this clock".

Add `cheapestSlotAcrossMidnight(before, after, kwh, powerKw, startAt)`. `before` is today's quarters from `startAt` through 24:00. `after` is tomorrow's quarters from 00:00 through 06:00. The search treats 24:00 as joining 00:00. The winner is still the shortest cheapest contiguous run. A run that fits entirely inside tomorrow is allowed. A run that starts today and ends tomorrow is allowed. No run that finishes by 06:00 returns null.

Tests: at 23:00, a 2-hour job prefers 23:00–01:00 when those quarters are the cheap ones and 00:00–02:00 costs more. A job that cannot finish by 06:00 returns null. Quarters that already ended are not chosen.

Run: `pnpm --filter home-automation-api test -- test/cheap-slot.test.ts`

### Task 3: The car line follows Home

**Files:**
- Modify: `apps/home-automation-api/src/services/energy-plan.ts`
- Test: `apps/home-automation-api/test/energy-plan.test.ts`

`CarJob` gains `atHome`. The car is on when `atHome` is true and `missingKwh` is above zero, whether or not `pluggedIn` is true. The car is off when `atHome` is false, and when the missing energy is zero. A null car stays `limited`.

The car slot uses `cheapestSlotAcrossMidnight` when the caller passes tomorrow's prices and a `startAt`. The tank slot stays on one day and still ends by 06:00. Replace the test that expects an unplugged car with missing energy to be off: unplugged, at home, 11 kWh missing, is on at 11 kW. The same car with `atHome` false is off.

Run: `pnpm --filter home-automation-api test -- test/energy-plan.test.ts`

### Task 4: Only Prague today gets the live car

**Files:**
- Modify: `apps/home-automation-api/src/routes/energy-plan.route.ts`
- Test: `apps/home-automation-api/test/energy-plan.route.test.ts`

Prague now comes from the same clock the collector uses. When the requested date is that calendar day:

- Before 06:00, the car window is today's prices from the next quarter to 06:00. Tomorrow's prices are not required.
- From 06:00 on, the car window is the rest of today plus tomorrow 00:00–06:00. Missing tomorrow prices return `error=missing_price` for that car window the same way a day with no prices already does.
- `atHome` and the missing energy come from the live reading. A thrown read sets the car line to `limited`.

When the requested date is any other day, the route does not use the live reading for the car. The car line is off.

The response body does not contain `geofence`, `latitude`, or `longitude`.

Update the route test that returns an unplugged car as off. A home car with 11 kWh missing and `pluggedIn` false returns `car=1`. The same request with `date` set to the day before returns `car=0`.

Run: `pnpm --filter home-automation-api test -- test/energy-plan.route.test.ts`

### Task 5: Today reloads on the page

**Files:**
- Modify: `apps/energy-view/src/scripts/dashboard.ts`

After a successful load, if the selected day is Prague today, arm one reload for 60 minutes. Changing the day, or a load of any other day, clears that timer. The reload calls the same `loadDay` the date buttons call. The plan sentence and the dashed Obluda stroke already read `carFrom` and `carTo`.

No new chart series. The Obluda chart keeps the plugged-in step from TeslaMate history.

### Task 6: The Miniserver follows a fresh plan

**Files:**
- Create: `src/loxone/energy-plan-follower.c`
- Modify: `src/loxone/water-tank-heating-controller.c`
- Modify: `src/loxone/wattsonic-inverter-state-manager.c`
- Modify: `src/loxone/ev-eco-power-calculation.c`

The fetch block pulls `GET /api/energy/plan` every 15 minutes over plain HTTP. A success older than one hour is not fresh. It does not replace the tank block, the car block, or the FVE block, and it does not write a wallbox limit or an inverter register.

Until Config, nothing changes in the house. The new inputs stay at 0, so each script keeps the rule it has. After the fetch block is pasted in, tie a constant 1 to "plan connected" on the tank block, the car block, and the FVE block. Connect fresh and that block's own command. A fresh car command of 1 sets the car block's power output to the plan's kW and raises its enable. A fresh command of 0 forces that enable off. A stale plan or a `limited` car line leaves the car block on its existing eco rule.

A fresh tank command of 1 heats only while the tank input still says the temperature is below the threshold. A fresh command of 0 stays off. A stale plan or a `limited` tank line heats a cold tank and ignores price. A connected plan does not grid-charge the house battery unless the plan says grid-charge and the clock is inside that slot. The cap is the plan's kW, and it does not exceed the 30% the inverter script already uses.
