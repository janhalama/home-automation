# Car wake schedule Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give Tesla a one-time charge schedule for the booked grid slot, and tell the Miniserver to open the wallbox fifteen minutes earlier and close it fifteen minutes later.

**Architecture:** Two pure functions decide the clocks. `wallboxWindow` widens the slot that `formatEnergyPlan` already sends as `carFrom` and `carTo`. `carScheduleAction` decides whether this poll adds, replaces, or removes the one-time schedule, or leaves the car alone. The stored day decision is not widened, so the bar stays the booked slot. A small client posts `add_charge_schedule` and `remove_charge_schedule` to a Tesla command proxy, which signs the command. The proxy URL is optional. With it unset, the wallbox text still widens and no command is sent. Design: `docs/adr/0018-the-wallbox-is-open-before-the-car-wakes.md`.

**Tech Stack:** TypeScript, Vitest, Fastify, the house SQLite archive, Tesla Fleet API `add_charge_schedule` with `one_time: true`.

---

### Task 1: Widen the wallbox slot

**Files:**
- Create: `apps/home-automation-api/src/services/wallbox-window.ts`
- Test: `apps/home-automation-api/test/wallbox-window.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { wallboxWindow } from "../src/services/wallbox-window.js";

describe("wallbox window", () => {
  it("opens one quarter early and closes one quarter late", () => {
    expect(wallboxWindow("02:30", "03:45")).toEqual({ from: "02:15", to: "04:00" });
  });

  it("does not open before midnight", () => {
    expect(wallboxWindow("00:00", "01:00")).toEqual({ from: "00:00", to: "01:15" });
  });

  it("keeps a slot that ends at midnight open until 00:15", () => {
    expect(wallboxWindow("22:45", "24:00")).toEqual({ from: "22:30", to: "00:15" });
  });

  it("keeps a slot that already crosses midnight", () => {
    expect(wallboxWindow("23:30", "01:00")).toEqual({ from: "23:15", to: "01:15" });
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `pnpm --filter home-automation-api test -- test/wallbox-window.test.ts`

Expected: FAIL with `wallboxWindow` not defined.

**Step 3: Write the minimal implementation**

```typescript
/*
The wallbox permission around a booked car slot.
Fifteen minutes is one price quarter. The Tesla schedule stays on the booked clocks.
*/

const MARGIN_MINUTES = 15;
const DAY_MINUTES = 24 * 60;

export type WallboxWindow = { from: string; to: string };

function minutes(clock: string): number {
  const [hour, minute] = clock.split(":");
  return Number(hour) * 60 + Number(minute);
}

function clock(total: number): string {
  const wrapped = ((total % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const hour = String(Math.floor(wrapped / 60)).padStart(2, "0");
  const minute = String(wrapped % 60).padStart(2, "0");
  return `${hour}:${minute}`;
}

/* True when the booked end is on the next morning. 24:00 is that midnight. */
function crossesMidnight(from: string, to: string): boolean {
  return minutes(to) <= minutes(from);
}

/* The clocks the Miniserver uses. A start that would fall on the previous day stays at 00:00. */
export function wallboxWindow(from: string, to: string): WallboxWindow {
  const start = minutes(from);
  const end = to === "24:00" ? DAY_MINUTES : minutes(to);
  const opened = start - MARGIN_MINUTES;
  const closed = end + MARGIN_MINUTES;
  if (!crossesMidnight(from, to) && opened < 0)
    return { from: "00:00", to: clock(closed) };
  return { from: clock(opened), to: clock(closed) };
}
```

**Step 4: Run the test to verify it passes**

Run: `pnpm --filter home-automation-api test -- test/wallbox-window.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/home-automation-api/src/services/wallbox-window.ts apps/home-automation-api/test/wallbox-window.test.ts
git commit -m "Widen the wallbox slot by one quarter on each side."
```

---

### Task 2: Put the wide clocks only in the Miniserver text

**Files:**
- Modify: `apps/home-automation-api/src/services/energy-plan.ts` (next to `formatEnergyPlan`)
- Test: `apps/home-automation-api/test/energy-plan.test.ts`

**Step 1: Write the failing test**

Add this next to the existing `formatEnergyPlan` tests:

```typescript
it("tells the wallbox to open one quarter around a grid slot", () => {
  const text = formatEnergyPlan(planForWallbox({
    ...offPlan,
    car: "on",
    carFrom: "02:30",
    carTo: "03:45",
    carKw: 11
  }));
  expect(text).toContain("carFrom=02:15");
  expect(text).toContain("carTo=04:00");
});

it("leaves a battery slot on its booked clocks", () => {
  const text = formatEnergyPlan(planForWallbox({
    ...offPlan,
    car: "battery",
    carFrom: "09:00",
    carTo: "11:00",
    carKw: 6
  }));
  expect(text).toContain("carFrom=09:00");
  expect(text).toContain("carTo=11:00");
});
```

`offPlan` is the fixture already used by `formatEnergyPlan` tests in that file. Reuse it. If the fixture name differs, use that name.

**Step 2: Run the test to verify it fails**

Run: `pnpm --filter home-automation-api test -- test/energy-plan.test.ts`

Expected: FAIL with `planForWallbox` not defined.

**Step 3: Write the minimal implementation**

In `energy-plan.ts`, import `wallboxWindow`. Add:

```typescript
/* The text the Miniserver reads. A grid slot is opened one quarter early and closed one quarter late. */
export function planForWallbox(plan: EnergyPlan): EnergyPlan {
  if (plan.car !== "on" || !plan.carFrom || !plan.carTo)
    return plan;
  const window = wallboxWindow(plan.carFrom, plan.carTo);
  return { ...plan, carFrom: window.from, carTo: window.to };
}
```

In `energy-plan.route.ts`, change the format call from `formatEnergyPlan(issued)` to `formatEnergyPlan(planForWallbox(issued))`. Do this after `issueTodayDecision` has saved the day. The stored segments stay on the booked clocks.

**Step 4: Run the test to verify it passes**

Run: `pnpm --filter home-automation-api test -- test/energy-plan.test.ts test/energy-plan.route.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/home-automation-api/src/services/energy-plan.ts apps/home-automation-api/src/routes/energy-plan.route.ts apps/home-automation-api/test/energy-plan.test.ts
git commit -m "Send the Miniserver the wallbox hours around the booked car slot."
```

---

### Task 3: Decide when the car is told

**Files:**
- Create: `apps/home-automation-api/src/services/car-schedule.ts`
- Test: `apps/home-automation-api/test/car-schedule.test.ts`

The schedule Tesla stores is the earliest grid segment whose start is still ahead of `now`. A start that has already passed is a missed charge. It is not sent. Replacing 02:30 with 22:45 at 06:05 is sent, because 22:45 is still ahead.

**Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { carScheduleAction, type CarSchedule } from "../src/services/car-schedule.js";
import type { DecisionSegment } from "../src/services/day-decision.js";

const morning: DecisionSegment = { kind: "car", from: "02:30", to: "03:45", kw: 11, mode: "grid" };
const slide: DecisionSegment = { kind: "car", from: "02:45", to: "04:00", kw: 11, mode: "grid" };
const tonight: DecisionSegment = { kind: "car", from: "22:45", to: "24:00", kw: 11, mode: "grid" };
const sent: CarSchedule = { id: 1, from: "02:30", to: "03:45" };

describe("car schedule action", () => {
  it("adds the booked slot when its start is still ahead", () => {
    expect(carScheduleAction({
      segments: [morning],
      sent: null,
      now: "00:08",
      carAtHome: true,
      carMissingKwh: 13.5
    })).toEqual({ action: "add", slot: { from: "02:30", to: "03:45" } });
  });

  it("leaves the car alone when the same slot was already sent", () => {
    expect(carScheduleAction({
      segments: [morning],
      sent,
      now: "01:00",
      carAtHome: true,
      carMissingKwh: 13.5
    })).toEqual({ action: "keep" });
  });

  it("does not send a quarter-hour slide whose start has passed", () => {
    expect(carScheduleAction({
      segments: [morning, slide],
      sent,
      now: "02:50",
      carAtHome: true,
      carMissingKwh: 13.5
    })).toEqual({ action: "keep" });
  });

  it("replaces the schedule when a later slot is still ahead", () => {
    expect(carScheduleAction({
      segments: [morning, tonight],
      sent,
      now: "06:05",
      carAtHome: true,
      carMissingKwh: 13.5
    })).toEqual({ action: "add", slot: { from: "22:45", to: "24:00" } });
  });

  it("removes the schedule when the car no longer needs a charge", () => {
    expect(carScheduleAction({
      segments: [morning],
      sent,
      now: "07:00",
      carAtHome: true,
      carMissingKwh: 0
    })).toEqual({ action: "remove" });
  });

  it("removes the schedule when the car leaves home", () => {
    expect(carScheduleAction({
      segments: [],
      sent,
      now: "12:00",
      carAtHome: false,
      carMissingKwh: 13.5
    })).toEqual({ action: "remove" });
  });

  it("does not remove a schedule when the car reading is missing", () => {
    expect(carScheduleAction({
      segments: [],
      sent,
      now: "12:00",
      carAtHome: null,
      carMissingKwh: null
    })).toEqual({ action: "keep" });
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `pnpm --filter home-automation-api test -- test/car-schedule.test.ts`

Expected: FAIL with `carScheduleAction` not defined.

**Step 3: Write the minimal implementation**

```typescript
/*
Whether this poll writes a one-time charge schedule to the car.
A grid slot whose start is still ahead is the schedule. A start that has passed is the missed charge and is not sent.
*/

import type { DecisionSegment } from "./day-decision.js";

export type CarSchedule = { id: number; from: string; to: string };

export type CarScheduleAction =
  | { action: "add"; slot: { from: string; to: string } }
  | { action: "remove" }
  | { action: "keep" };

function minutes(clock: string): number {
  const [hour, minute] = clock.split(":");
  return Number(hour) * 60 + Number(minute);
}

/* The earliest grid slot that has not started. 24:00 is the end of the day, not a start. */
function nextGridSlot(segments: DecisionSegment[], now: string): { from: string; to: string } | null {
  const at = minutes(now);
  const ahead = segments
    .filter((segment) => segment.kind === "car" && segment.mode === "grid" && minutes(segment.from) > at)
    .sort((left, right) => minutes(left.from) - minutes(right.from));
  return ahead[0] ? { from: ahead[0].from, to: ahead[0].to } : null;
}

/* Add, replace, remove, or keep. A null car reading is not a reason to remove. */
export function carScheduleAction(input: {
  segments: DecisionSegment[];
  sent: CarSchedule | null;
  now: string;
  carAtHome: boolean | null;
  carMissingKwh: number | null;
}): CarScheduleAction {
  const readingMissing = input.carAtHome === null || input.carMissingKwh === null;
  const finished = !readingMissing && (input.carAtHome === false || input.carMissingKwh <= 0);
  if (finished)
    return input.sent ? { action: "remove" } : { action: "keep" };
  const slot = nextGridSlot(input.segments, input.now);
  if (!slot)
    return { action: "keep" };
  if (input.sent && input.sent.from === slot.from && input.sent.to === slot.to)
    return { action: "keep" };
  return { action: "add", slot };
}
```

**Step 4: Run the test to verify it passes**

Run: `pnpm --filter home-automation-api test -- test/car-schedule.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/home-automation-api/src/services/car-schedule.ts apps/home-automation-api/test/car-schedule.test.ts
git commit -m "Send the car only a grid slot that has not started."
```

---

### Task 4: Remember the schedule that was accepted

**Files:**
- Create: `apps/home-automation-api/src/services/car-schedule-store.ts`
- Test: `apps/home-automation-api/test/car-schedule-store.test.ts`
- Modify: `apps/home-automation-api/src/services/house-archive.ts` (open the same database; do not add the schedule methods to the archive file)

**Step 1: Write the failing test**

```typescript
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openHouseArchive } from "../src/services/house-archive.js";
import { carScheduleStore } from "../src/services/car-schedule-store.js";

describe("car schedule store", () => {
  it("returns null until a schedule has been accepted", () => {
    const dir = mkdtempSync(join(tmpdir(), "car-schedule-"));
    const archive = openHouseArchive(join(dir, "house.sqlite"));
    const store = carScheduleStore(archive.database);
    expect(store.read()).toBeNull();
    store.save({ id: 1, from: "02:30", to: "03:45" });
    expect(store.read()).toEqual({ id: 1, from: "02:30", to: "03:45" });
    store.clear();
    expect(store.read()).toBeNull();
  });
});
```

`openHouseArchive` must expose the `DatabaseSync` it already holds. If the return value keeps the database private, add a `database` field to the object it returns. Do not copy the schedule rows into `plan_inputs`.

**Step 2: Run the test to verify it fails**

Run: `pnpm --filter home-automation-api test -- test/car-schedule-store.test.ts`

Expected: FAIL with `carScheduleStore` not defined.

**Step 3: Write the minimal implementation**

One row, id 1. Columns `from_clock` and `to_clock`. `read` returns null when the table is empty. `save` replaces that row. `clear` deletes it. Create the table with `CREATE TABLE IF NOT EXISTS car_schedule`.

**Step 4: Run the test to verify it passes**

Run: `pnpm --filter home-automation-api test -- test/car-schedule-store.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/home-automation-api/src/services/car-schedule-store.ts apps/home-automation-api/src/services/house-archive.ts apps/home-automation-api/test/car-schedule-store.test.ts
git commit -m "Remember the charge schedule the car accepted."
```

---

### Task 5: Build the one-time Fleet request

**Files:**
- Create: `apps/home-automation-api/src/services/fleet-charge-schedule.ts`
- Test: `apps/home-automation-api/test/fleet-charge-schedule.test.ts`

The body matches Tesla's `add_charge_schedule`. `one_time` is true. `id` is 1, so a later add updates that schedule instead of stacking a second one. Times are minutes after midnight in Prague. `24:00` is sent as `0`, which is the following midnight. `days_of_week` is the English weekday of the plan date, so a Sunday slot is `"Sunday"`.

**Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { addChargeScheduleBody, removeChargeScheduleBody } from "../src/services/fleet-charge-schedule.js";

describe("fleet charge schedule", () => {
  it("builds a one-time schedule for the booked slot", () => {
    expect(addChargeScheduleBody({
      date: "2026-11-22",
      from: "02:30",
      to: "03:45",
      lat: 50.6920036,
      lon: 15.2203556
    })).toEqual({
      id: 1,
      enabled: true,
      one_time: true,
      days_of_week: "Sunday",
      start_enabled: true,
      start_time: 150,
      end_enabled: true,
      end_time: 225,
      lat: 50.6920036,
      lon: 15.2203556
    });
  });

  it("sends an end at midnight as minute 0", () => {
    const body = addChargeScheduleBody({
      date: "2026-11-22",
      from: "22:45",
      to: "24:00",
      lat: 50.6920036,
      lon: 15.2203556
    });
    expect(body.start_time).toBe(22 * 60 + 45);
    expect(body.end_time).toBe(0);
    expect(body.one_time).toBe(true);
  });

  it("removes schedule 1", () => {
    expect(removeChargeScheduleBody()).toEqual({ id: 1 });
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `pnpm --filter home-automation-api test -- test/fleet-charge-schedule.test.ts`

Expected: FAIL with `addChargeScheduleBody` not defined.

**Step 3: Write the minimal implementation**

`HOUSE_SCHEDULE_ID` is 1. Weekday comes from `new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Prague", weekday: "long" })` applied to `${date}T12:00:00Z`, so the name is the Prague weekday of that date. Do not send `charge_start`. Do not send amps.

**Step 4: Run the test to verify it passes**

Run: `pnpm --filter home-automation-api test -- test/fleet-charge-schedule.test.ts`

Expected: PASS. 22 November 2026 is a Sunday.

**Step 5: Commit**

```bash
git add apps/home-automation-api/src/services/fleet-charge-schedule.ts apps/home-automation-api/test/fleet-charge-schedule.test.ts
git commit -m "Build a one-time home charge schedule for the booked slot."
```

---

### Task 6: Post the command when a proxy is configured

**Files:**
- Modify: `apps/home-automation-api/src/services/fleet-charge-schedule.ts`
- Modify: `apps/home-automation-api/src/config/environment.ts`
- Test: `apps/home-automation-api/test/fleet-charge-schedule.test.ts`
- Modify: `apps/home-automation-api/src/routes/energy-plan.route.ts`
- Modify: `apps/home-automation-api/src/create-app.ts`

The car on 2026.38.6 rejects an unsigned command. This API does not hold the virtual key. `TESLA_COMMAND_PROXY_URL` is the base URL of a Tesla vehicle-command proxy that already has the key. `TESLA_VIN` is Obluda. Both empty means the write is skipped.

**Step 1: Write the failing test**

```typescript
it("posts add_charge_schedule and returns the schedule that was accepted", async () => {
  const calls: { url: string; body: unknown }[] = [];
  const sent = await sendCarSchedule({
    proxyUrl: "http://proxy.example",
    vin: "VIN",
    action: { action: "add", slot: { from: "02:30", to: "03:45" } },
    date: "2026-11-22",
    lat: 50.6920036,
    lon: 15.2203556,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ response: { result: true } }), { status: 200 });
    }
  });
  expect(calls[0].url).toBe("http://proxy.example/api/1/vehicles/VIN/command/add_charge_schedule");
  expect(calls[0].body).toMatchObject({ one_time: true, id: 1, start_time: 150 });
  expect(sent).toEqual({ id: 1, from: "02:30", to: "03:45" });
});

it("returns null when the proxy rejects the command", async () => {
  const sent = await sendCarSchedule({
    proxyUrl: "http://proxy.example",
    vin: "VIN",
    action: { action: "remove" },
    date: "2026-11-22",
    lat: 50.6920036,
    lon: 15.2203556,
    fetchImpl: async () => new Response("no", { status: 500 })
  });
  expect(sent).toBeNull();
});
```

**Step 2: Run the test to verify it fails**

Run: `pnpm --filter home-automation-api test -- test/fleet-charge-schedule.test.ts`

Expected: FAIL with `sendCarSchedule` not defined.

**Step 3: Write the minimal implementation**

`sendCarSchedule` POSTs JSON. `add` uses `addChargeScheduleBody`. `remove` posts `removeChargeScheduleBody()` to `.../command/remove_charge_schedule`. A response that is not 200, or a body whose `response.result` is not true, returns null. `add` returns `{ id: 1, from, to }` only after success. `remove` returns `{ id: 1, from: "", to: "" }` on success so the caller can clear the row. The route treats a null return as a failed write: log `car schedule was not accepted`, do not change the stored row, do not change the booked slot.

In the plan route, after today's decision is saved and only when `lookAhead` is true:

```typescript
const action = carScheduleAction({
  segments: archive.listDayDecisions(date),
  sent: scheduleStore.read(),
  now: pragueClock(now),
  carAtHome: car ? car.atHome : null,
  carMissingKwh: car ? car.missingKwh : null
});
```

`car` here is the reading already taken in the route, or null when TeslaMate did not answer. Call `sendCarSchedule` only when `action.action` is not `keep` and both proxy settings are set. On `add` success, `scheduleStore.save`. On `remove` success, `scheduleStore.clear`.

Add `teslaCommandProxyUrl` and `teslaVin` to `readEnvironmentConfig`, from `TESLA_COMMAND_PROXY_URL` and `TESLA_VIN`, trimmed, default `""`. Pass them into the plan route deps from `create-app.ts`.

**Step 4: Run the test to verify it passes**

Run: `pnpm --filter home-automation-api test -- test/fleet-charge-schedule.test.ts test/energy-plan.route.test.ts`

Expected: PASS. Existing route tests have no proxy configured, so they must not call `fetch`.

**Step 5: Commit**

```bash
git add apps/home-automation-api/src/services/fleet-charge-schedule.ts apps/home-automation-api/src/config/environment.ts apps/home-automation-api/src/routes/energy-plan.route.ts apps/home-automation-api/src/create-app.ts apps/home-automation-api/test/fleet-charge-schedule.test.ts
git commit -m "Write a one-time charge schedule when the proxy is configured."
```

---

## Out of scope

The command proxy itself is not in this repo. Until `TESLA_COMMAND_PROXY_URL` and `TESLA_VIN` are set on the API, the Miniserver text is widened and the car is not told.

A slot that sits entirely after midnight is still compared as a clock on today. That is the day decision's existing rule. This plan does not change it.

No `charge_start`. No amp command. No repeating weekday schedule.
