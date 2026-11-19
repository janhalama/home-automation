/*
The day keeps a decision that has started, and names one cause when the rest changes.
*/

import { describe, expect, it } from "vitest";
import { futureChange, mergeDecision, type DecisionSegment, type PlanInputs } from "../src/services/day-decision.js";

const tankMorning: DecisionSegment = { kind: "tank", from: "08:00", to: "12:00", kw: 2.5, mode: "" };
const tankEvening: DecisionSegment = { kind: "tank", from: "20:00", to: "23:00", kw: 2.5, mode: "" };
const buy: DecisionSegment = { kind: "battery-buy", from: "00:00", to: "02:15", kw: 2.5, mode: "" };
const car: DecisionSegment = { kind: "car", from: "09:00", to: "11:00", kw: 11, mode: "grid" };

function inputs(patch: Partial<PlanInputs> = {}): PlanInputs {
  return {
    bookedChargeEnded: false,
    clock: "10:00",
    todayPrices: "a",
    tomorrowPricesArrived: false,
    tankC: 40,
    carAtHome: false,
    carMissingKwh: 0,
    nightCharging: true,
    socPercent: 50,
    expectedSunKwh: 4,
    nightHouseKwh: 6,
    daylightHouseKwh: 8,
    season: "autumn",
    ...patch
  };
}

describe("merge decision", () => {
  it("keeps a tank window that has started when the proposal turns the tank off", () => {
    const merged = mergeDecision([tankMorning], [], "10:00");
    expect(merged).toContainEqual(tankMorning);
  });

  it("replaces a tank window that has not started", () => {
    const next: DecisionSegment = { kind: "tank", from: "21:00", to: "23:00", kw: 2.5, mode: "" };
    const merged = mergeDecision([tankMorning, tankEvening], [next], "10:00");
    expect(merged).toContainEqual(tankMorning);
    expect(merged).not.toContainEqual(tankEvening);
    expect(merged).toContainEqual(next);
  });

  it("keeps a battery buy while the clock is inside it", () => {
    expect(mergeDecision([buy], [], "01:00")).toContainEqual(buy);
  });

  it("keeps a battery buy the proposal already started when nothing was stored yet", () => {
    expect(mergeDecision([], [buy], "01:00")).toContainEqual(buy);
  });

  it("marks a wait where a car window is on and the battery is not buying", () => {
    const merged = mergeDecision([car], [], "10:00");
    expect(merged).toContainEqual({ kind: "battery-wait", from: "09:00", to: "11:00", kw: 0, mode: "" });
  });
});

describe("future change", () => {
  it("adds no line when the hours still ahead are the same", () => {
    const same = [tankEvening];
    expect(futureChange(same, same, inputs(), inputs({ clock: "11:00" }))).toBeNull();
  });

  it("names a car that comes home", () => {
    const slot: DecisionSegment = { kind: "car", from: "23:00", to: "24:00", kw: 11, mode: "grid" };
    const line = futureChange([], [slot], inputs({ clock: "16:00" }), inputs({ clock: "16:00", carAtHome: true, carMissingKwh: 11 }));
    expect(line?.trigger).toBe("Car plugged in");
    expect(line?.segments).toEqual([slot]);
  });

  it("names the tank reaching 55°C", () => {
    const line = futureChange(
      [tankEvening],
      [],
      inputs({ clock: "18:00", tankC: 48 }),
      inputs({ clock: "18:00", tankC: 55 })
    );
    expect(line?.trigger).toBe("Tank reached 55°C");
  });

  it("names the tank when the clock moved as well", () => {
    const line = futureChange(
      [tankEvening],
      [],
      inputs({ clock: "10:00", tankC: 48 }),
      inputs({ clock: "13:00", tankC: 55 })
    );
    expect(line?.trigger).toBe("Tank reached 55°C");
  });

  it("names the clock when the hours ahead changed and nothing else did", () => {
    const line = futureChange([tankEvening], [], inputs({ clock: "10:00" }), inputs({ clock: "13:00" }));
    expect(line?.trigger).toBe("The clock");
  });

  it("names the earlier input when two change at once", () => {
    const slot: DecisionSegment = { kind: "car", from: "23:00", to: "24:00", kw: 11, mode: "grid" };
    const line = futureChange(
      [],
      [slot],
      inputs(),
      inputs({ todayPrices: "b", carAtHome: true, carMissingKwh: 11 })
    );
    expect(line?.trigger).toBe("Today's prices");
  });
});
