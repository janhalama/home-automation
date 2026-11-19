/*
A booked grid charge survives later polls until the window ends.
*/

import { describe, expect, it } from "vitest";
import { chargeWindow, keepChargeWindow } from "../src/services/charge-commitment.js";

const midday = chargeWindow("12:45", "14:00", 6);

describe("charge commitment", () => {
  it("keeps the booked window when a later poll proposes nothing", () => {
    const kept = keepChargeWindow([midday], null, "13:30", []);
    expect(kept.active).toEqual(midday);
    expect(kept.booked).toEqual([midday]);
    expect(kept.fault).toBe(false);
  });

  it("leaves the booked window in place when a later poll proposes another", () => {
    const evening = chargeWindow("22:00", "23:15", 6);
    const kept = keepChargeWindow([midday], evening, "13:00", []);
    expect(kept.active).toEqual(midday);
    expect(kept.booked).toEqual([midday]);
  });

  it("ends the window at its clock and books the next different one", () => {
    const evening = chargeWindow("22:00", "23:15", 6);
    const kept = keepChargeWindow([midday], evening, "14:00", []);
    expect(kept.active).toEqual(evening);
    expect(kept.booked).toEqual([midday, evening]);
  });

  it("ends the window once the pack has taken the energy it was sized for", () => {
    const samples = [
      { clock: "12:45", batteryKw: -6 },
      { clock: "13:00", batteryKw: -6 },
      { clock: "13:15", batteryKw: -6 },
      { clock: "13:30", batteryKw: -6 },
      { clock: "13:45", batteryKw: -6 }
    ];
    const kept = keepChargeWindow([midday], midday, "13:50", samples);
    expect(kept.active).toBeNull();
    expect(kept.booked).toEqual([midday]);
  });

  it("reports a fault when a sample inside the window is not charging", () => {
    const kept = keepChargeWindow(
      [midday],
      null,
      "13:15",
      [{ clock: "13:00", batteryKw: 0.2 }]
    );
    expect(kept.fault).toBe(true);
    expect(kept.active).toEqual(midday);
  });

  it("stays quiet before any sample falls inside the window", () => {
    const kept = keepChargeWindow([midday], null, "12:50", [{ clock: "12:00", batteryKw: 0 }]);
    expect(kept.fault).toBe(false);
    expect(kept.active).toEqual(midday);
  });
});
