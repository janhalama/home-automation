/*
The battery plan row keeps a charge that already ran.
*/

import { describe, expect, it } from "vitest";
import { batteryChargeSentence, batteryMeasuredParts, batteryPlanKw, batteryPlanParts, batteryPlanTitle, type BatteryPlanWindow } from "./battery-plan-series.ts";

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

  it("draws the house in its own hours and the sale only while energy is sold", () => {
    const plan: BatteryPlanWindow = {
      ...hold,
      batterySellFrom: "17:30",
      batterySellTo: "18:30",
      batterySellKw: 8,
      batteryDischargeFrom: "18:00",
      batteryDischargeTo: "06:00",
      batteryDischargeKw: 0.17
    };
    expect(batteryPlanParts("17:45", plan, null, null)).toEqual({ buy: 0, house: 0, sale: 8 });
    expect(batteryPlanParts("19:00", plan, null, null)).toEqual({ buy: 0, house: 0.17, sale: 0 });
    expect(batteryPlanParts("12:00", plan, null, null)).toEqual({ buy: 0, house: 0, sale: 0 });
  });

  it("splits a measured charge into the grid buy and the sun", () => {
    expect(batteryMeasuredParts(-4, 1, false)).toEqual({ buy: 0, sun: -4, house: 0, sale: 0 });
    expect(batteryMeasuredParts(-6, -7, false)).toEqual({ buy: -6, sun: 0, house: 0, sale: 0 });
    expect(batteryMeasuredParts(-4, -2, false)).toEqual({ buy: -2, sun: -2, house: 0, sale: 0 });
    expect(batteryMeasuredParts(-3, null, false)).toEqual({ buy: -3, sun: 0, house: 0, sale: 0 });
    expect(batteryMeasuredParts(8, 8, true)).toEqual({ buy: 0, sun: 0, house: 0, sale: 8 });
    expect(batteryMeasuredParts(0.17, -1, false)).toEqual({ buy: 0, sun: 0, house: 0.17, sale: 0 });
    expect(batteryMeasuredParts(null, -1, false)).toEqual({ buy: null, sun: null, house: null, sale: null });
  });

  it("keeps a charge that is still ahead on the live plan", () => {
    const evening: BatteryPlanWindow = { ...nightCharge, batteryFrom: "22:00", batteryTo: "24:00" };
    const now = 17 * 60;
    expect(batteryPlanKw("22:00", evening, hold, now)).toBe(-3);
    expect(batteryPlanTitle(evening, hold, now)).toBe("Battery plan, charge 22:00–24:00");
  });
});
