/*
The battery plan row keeps a charge that already ran.
*/

import { describe, expect, it } from "vitest";
import { batteryChargeSentence, batteryPlanKw, batteryPlanTitle, type BatteryPlanWindow } from "./battery-plan-series.ts";

const hold: BatteryPlanWindow = {
  batteryFrom: null,
  batteryTo: null,
  batteryKw: 0,
  batterySellFrom: null,
  batterySellTo: null,
  batterySellKw: 0
};

const nightCharge: BatteryPlanWindow = {
  batteryFrom: "00:00",
  batteryTo: "05:00",
  batteryKw: 3,
  batterySellFrom: null,
  batterySellTo: null,
  batterySellKw: 0
};

describe("battery plan row", () => {
  it("draws the night charge from the opening plan after that window has passed", () => {
    const now = 17 * 60 + 52;
    expect(batteryPlanKw("02:00", hold, nightCharge, now)).toBe(-3);
    expect(batteryPlanKw("18:00", hold, nightCharge, now)).toBeNull();
    expect(batteryPlanTitle(hold, nightCharge, now)).toBe("Battery plan, charge 00:00–05:00");
    expect(batteryChargeSentence(hold, nightCharge, now)).toBe("Battery charge 00:00–05:00 at 3.0 kW");
  });

  it("keeps 6 kW outside the car and drops only while the car and the tank are on", () => {
    const plan: BatteryPlanWindow = {
      batteryFrom: "03:30",
      batteryTo: "05:00",
      batteryKw: 6,
      batterySellFrom: null,
      batterySellTo: null,
      batterySellKw: 0,
      tankFrom: "01:30",
      tankTo: "05:15",
      carFrom: "03:45",
      carTo: "04:30",
      carKw: 11
    };
    expect(batteryPlanKw("03:30", plan, null, null)).toBe(-6);
    expect(batteryPlanKw("04:00", plan, null, null)).toBe(-2.5);
    expect(batteryPlanKw("04:30", plan, null, null)).toBe(-6);
  });

  it("keeps a charge that is still ahead on the live plan", () => {
    const evening: BatteryPlanWindow = { ...nightCharge, batteryFrom: "22:00", batteryTo: "24:00" };
    const now = 17 * 60;
    expect(batteryPlanKw("22:00", evening, hold, now)).toBe(-3);
    expect(batteryPlanTitle(evening, hold, now)).toBe("Battery plan, charge 22:00–24:00");
  });
});
