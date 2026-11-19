/*
The battery plan row keeps a charge that already ran.
*/

import { describe, expect, it } from "vitest";
import { batteryChargeSentence, batteryMeasuredParts, batteryPlanKw, batteryPlanParts, batteryPlanTitle, type BatteryPlanWindow } from "./battery-plan-series.ts";
import { batteryFlowParts, batteryPlanSeries, heaterSeries, tankPlanSeries, type StoredSegment } from "./stored-plan-series.ts";

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

  it("draws the sale only while energy is sold and does not schedule the house", () => {
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
    expect(batteryPlanParts("19:00", plan, null, null)).toEqual({ buy: 0, house: 0, sale: 0 });
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

  it("leaves a charge on the sun when the panels covered it during a house import", () => {
    expect(batteryMeasuredParts(-1.5, -4, false, 2)).toEqual({ buy: 0, sun: -1.5, house: 0, sale: 0 });
    expect(batteryMeasuredParts(-6, -7, false, 0.5)).toEqual({ buy: -5.5, sun: -0.5, house: 0, sale: 0 });
    expect(batteryMeasuredParts(-6, -7, false, 0)).toEqual({ buy: -6, sun: 0, house: 0, sale: 0 });
  });

  it("counts a sale only for the power that left through the meter", () => {
    expect(batteryMeasuredParts(0.5, 0, true)).toEqual({ buy: 0, sun: 0, house: 0.5, sale: 0 });
    expect(batteryMeasuredParts(0.5, -0.4, true)).toEqual({ buy: 0, sun: 0, house: 0.5, sale: 0 });
    expect(batteryMeasuredParts(0.5, 0.2, true)).toEqual({ buy: 0, sun: 0, house: 0.3, sale: 0.2 });
  });

  it("draws the stored charge and leaves a sunrise window that was never booked", () => {
    const live: BatteryPlanWindow = {
      ...hold,
      batteryCharges: [{ from: "12:45", to: "14:00", kw: 6 }]
    };
    const now = 13 * 60;
    expect(batteryPlanKw("13:00", live, nightCharge, now)).toBe(-6);
    expect(batteryPlanKw("02:00", live, nightCharge, now)).toBe(0);
    expect(batteryPlanTitle(live, nightCharge, now)).toBe("Battery plan, charge 12:45–14:00");
    expect(batteryChargeSentence(live, nightCharge, now)).toBe("Battery charge 12:45–14:00 at 6.0 kW");
  });

  it("draws no charge when the stored list is empty", () => {
    const live: BatteryPlanWindow = { ...hold, batteryCharges: [] };
    expect(batteryPlanTitle(live, nightCharge, 17 * 60)).toBe("Battery plan off");
    expect(batteryPlanKw("02:00", live, nightCharge, 17 * 60)).toBe(0);
  });

  it("keeps a charge that is still ahead on the live plan", () => {
    const evening: BatteryPlanWindow = { ...nightCharge, batteryFrom: "22:00", batteryTo: "24:00" };
    const now = 17 * 60;
    expect(batteryPlanKw("22:00", evening, hold, now)).toBe(-3);
    expect(batteryPlanTitle(evening, hold, now)).toBe("Battery plan, charge 22:00–24:00");
  });
});

const storedTank: StoredSegment = { kind: "tank", from: "08:00", to: "12:00", kw: 2.5, mode: "" };

describe("stored plan rows", () => {
  it("leaves the plan empty when nothing was stored", () => {
    expect(tankPlanSeries(["08:00", "08:15"], [])).toEqual([null, null]);
    expect(batteryPlanSeries(["18:00"], []).sale).toEqual([null]);
  });

  it("draws a stored tank and a stored sale from the decision, not from a fresh plan", () => {
    expect(tankPlanSeries(["08:00", "12:00"], [storedTank])).toEqual([2.5, 0]);
    const battery = batteryPlanSeries(["18:00", "19:00"], [
      { kind: "battery-sell", from: "18:00", to: "19:00", kw: 8, mode: "" }
    ]);
    expect(battery.sale).toEqual([8, 0]);
    expect(battery.buy).toEqual([null, null]);
  });

  it("puts a buy below zero", () => {
    expect(batteryPlanSeries(["01:00"], [
      { kind: "battery-buy", from: "00:00", to: "02:00", kw: 6, mode: "" }
    ]).buy).toEqual([-6]);
  });

  it("keeps heater minutes inside the stored tank with the plan and minutes outside as the house", () => {
    const split = heaterSeries(["08:00", "13:00"], [1, 1], [storedTank]);
    expect(split.plan).toEqual([1, 0]);
    expect(split.house).toEqual([0, 1]);
    expect(split.houseActed).toBe(true);
  });

  it("draws the heater as one series when no tank decision was stored", () => {
    const split = heaterSeries(["13:00"], [1], []);
    expect(split.plan).toEqual([1]);
    expect(split.house).toEqual([null]);
    expect(split.houseActed).toBe(false);
  });

  it("shows the house in orange above zero and a sale when the meter exports", () => {
    expect(batteryFlowParts(-2, -2)).toEqual({ buy: -2, house: 0, sale: 0 });
    expect(batteryFlowParts(0.4, -0.3)).toEqual({ buy: 0, house: 0.4, sale: 0 });
    expect(batteryFlowParts(4, 4)).toEqual({ buy: 0, house: 0, sale: 4 });
  });
});
