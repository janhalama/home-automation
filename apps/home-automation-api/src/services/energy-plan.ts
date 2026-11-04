/*
One plan for the tank, the car, and the home battery.
Hot water finishes by 06:00 on the same day. The car finishes by the next 06:00 and may cross midnight.
The battery takes the cheapest period long enough, including daytime.
*/

import { cheapestSlot, cheapestSlotAcrossMidnight, type PriceQuarter, type Slot } from "./cheap-slot.js";
import type { SpotPrice } from "./ote-day-ahead.js";
import { cloudBand, houseGridKwh, overnightKwh, type Season } from "./seasonal-profile.js";

const TANK_LITERS = 200;
const TANK_TARGET_C = 55;
const WATER_KJ_PER_LITER_K = 4.186;
const TANK_KW = 2.5;
const CAR_KW = 11;
const HOUSE_KW = 1;
const BREAKER_KW = 17;
const BATTERY_CHARGE_MAX_KW = 3;
const DEADLINE = "06:00";
const SELL_BAND_EUR_PER_MWH = 20;
const SELL_KW = 8;
const DISCHARGE_FROM = "18:00";
const DISCHARGE_TO = "06:00";
const DISCHARGE_HOURS = 12;

export type CarJob = {
  missingKwh: number;
  pluggedIn: boolean;
  atHome: boolean;
} | null;

export type EnergyPlan = {
  tank: "on" | "off" | "limited";
  tankFrom: string | null;
  tankTo: string | null;
  car: "on" | "off" | "limited";
  carFrom: string | null;
  carTo: string | null;
  carKw: number;
  battery: "grid-charge" | "hold";
  batteryKw: number;
  batteryFrom: string | null;
  batteryTo: string | null;
  batterySellFrom: string | null;
  batterySellTo: string | null;
  batterySellKw: number;
  batteryDischargeKw: number;
  batteryDischargeFrom: string | null;
  batteryDischargeTo: string | null;
};

/* Average power of the energy above the floor that covers the house from 18:00 to 06:00. */
function houseDischargeKw(aboveFloorKwh: number | null, season: Season): number {
  if (aboveFloorKwh === null)
    return 0;
  const covered = Math.min(Math.max(0, aboveFloorKwh), overnightKwh(season));
  if (covered <= 0)
    return 0;
  return covered / DISCHARGE_HOURS;
}

/* Kilowatt-hours to bring 200 l from the measured temperature up to 55°C. */
function tankEnergyKwh(temperatureC: number): number {
  const rise = TANK_TARGET_C - temperatureC;
  if (rise <= 0)
    return 0;
  return TANK_LITERS * WATER_KJ_PER_LITER_K * rise / 3600;
}

/* Power left for the home battery after the house, and after a tank or car that is also on. */
function batteryChargeKw(tankOn: boolean, carOn: boolean): number {
  const taken = HOUSE_KW + (tankOn ? TANK_KW : 0) + (carOn ? CAR_KW : 0);
  const room = BREAKER_KW - taken;
  if (room <= 0)
    return 0;
  return Math.min(BATTERY_CHARGE_MAX_KW, room);
}
/* Copy a slot onto a from/to pair, or leave both empty. */
function placed(slot: Slot | null): { from: string | null; to: string | null } {
  if (!slot)
    return { from: null, to: null };
  return { from: slot.from, to: slot.to };
}

/* Quarters the slot search can price. */
function priced(prices: SpotPrice[]): PriceQuarter[] {
  return prices.map((price) => ({
    periodInterval: price.periodInterval,
    eurPerMwh: price.eurPerMwh
  }));
}

/* Car slot. Tomorrow extends the run across midnight. Otherwise the run stays on this day. */
function carRun(
  today: PriceQuarter[],
  tomorrow: PriceQuarter[] | null,
  missingKwh: number,
  startAt: string | null
): Slot | null {
  if (tomorrow && startAt)
    return cheapestSlotAcrossMidnight(today, tomorrow, missingKwh, CAR_KW, startAt);
  return cheapestSlot(today, missingKwh, CAR_KW, DEADLINE, startAt);
}

/* The run of quarters around the day's highest price, when that peak stands above the rest of the day. */
function peakSellSlot(quarters: PriceQuarter[]): Slot | null {
  if (quarters.length === 0)
    return null;
  let max = quarters[0].eurPerMwh;
  let min = quarters[0].eurPerMwh;
  let peak = 0;
  quarters.forEach((quarter, index) => {
    if (quarter.eurPerMwh > max) {
      max = quarter.eurPerMwh;
      peak = index;
    }
    if (quarter.eurPerMwh < min)
      min = quarter.eurPerMwh;
  });
  if (max - min < SELL_BAND_EUR_PER_MWH)
    return null;
  let start = peak;
  let end = peak;
  while (start > 0 && quarters[start - 1].eurPerMwh >= max - SELL_BAND_EUR_PER_MWH)
    start -= 1;
  while (end < quarters.length - 1 && quarters[end + 1].eurPerMwh >= max - SELL_BAND_EUR_PER_MWH)
    end += 1;
  const from = quarters[start].periodInterval.split("-")[0];
  const to = quarters[end].periodInterval.split("-")[1];
  return { from, to };
}

/* True when two clock windows share a quarter. */
function slotsOverlap(left: Slot | null, right: Slot | null): boolean {
  if (!left || !right)
    return false;
  const minutes = (clock: string) => {
    const [hour, minute] = clock.split(":");
    return Number(hour) * 60 + Number(minute);
  };
  return minutes(left.from) < minutes(right.to) && minutes(right.from) < minutes(left.to);
}

/* Build the three lines from prices and the readings the API already has. */
export function buildEnergyPlan(input: {
  prices: SpotPrice[];
  tomorrowPrices?: SpotPrice[];
  startAt?: string | null;
  bottomTemperatureC: number | null;
  aboveFloorKwh: number | null;
  season: Season;
  lowCloudPercent: number | null;
  car: CarJob;
}): EnergyPlan {
  if (input.prices.length === 0)
    throw new Error("The price for this day is missing");

  const quarters = priced(input.prices);
  const tankKwh = input.bottomTemperatureC === null ? 0 : tankEnergyKwh(input.bottomTemperatureC);
  const needsTank = tankKwh > 0;
  const tankSlot = needsTank ? cheapestSlot(quarters, tankKwh, TANK_KW, DEADLINE) : null;
  const tank = input.bottomTemperatureC === null ? "limited" : needsTank ? tankSlot ? "on" : "limited" : "off";
  const tankTimes = placed(tank === "on" ? tankSlot : null);

  const carWanted = input.car !== null && input.car.atHome && input.car.missingKwh > 0;
  const tomorrow = input.tomorrowPrices ? priced(input.tomorrowPrices) : null;
  const carSlot = carWanted && input.car
    ? carRun(quarters, tomorrow, input.car.missingKwh, input.startAt ?? null)
    : null;
  const car = input.car === null ? "limited" : carWanted ? carSlot ? "on" : "limited" : "off";
  const carTimes = placed(car === "on" ? carSlot : null);

  const batteryPowerKw = batteryChargeKw(tank === "on", car === "on");
  const batteryKwh = input.lowCloudPercent === null || input.aboveFloorKwh === null
    ? 0
    : houseGridKwh(input.season, cloudBand(input.lowCloudPercent), input.aboveFloorKwh);
  const batterySlot = batteryKwh > 0
    ? cheapestSlot(quarters, batteryKwh, batteryPowerKw, null)
    : null;
  const batteryTimes = placed(batterySlot);
  const sellCandidate = input.aboveFloorKwh !== null && input.aboveFloorKwh > 0
    ? peakSellSlot(quarters)
    : null;
  const sellSlot = slotsOverlap(sellCandidate, batterySlot) ? null : sellCandidate;
  const dischargeKw = houseDischargeKw(input.aboveFloorKwh, input.season);

  return {
    tank,
    tankFrom: tankTimes.from,
    tankTo: tankTimes.to,
    car,
    carFrom: carTimes.from,
    carTo: carTimes.to,
    carKw: car === "on" ? CAR_KW : 0,
    battery: batterySlot ? "grid-charge" : "hold",
    batteryKw: batterySlot ? batteryPowerKw : 0,
    batteryFrom: batteryTimes.from,
    batteryTo: batteryTimes.to,
    batterySellFrom: sellSlot?.from ?? null,
    batterySellTo: sellSlot?.to ?? null,
    batterySellKw: sellSlot ? SELL_KW : 0,
    batteryDischargeKw: dischargeKw,
    batteryDischargeFrom: dischargeKw > 0 ? DISCHARGE_FROM : null,
    batteryDischargeTo: dischargeKw > 0 ? DISCHARGE_TO : null
  };
}

/* Plain text the Miniserver program already knows how to parse. */
export function formatEnergyPlan(plan: EnergyPlan): string {
  const flag = (value: "on" | "off" | "limited") => value === "on" ? "1" : value === "off" ? "0" : "limited";
  return [
    `tank=${flag(plan.tank)}`,
    `tankFrom=${plan.tankFrom ?? ""}`,
    `tankTo=${plan.tankTo ?? ""}`,
    `car=${flag(plan.car)}`,
    `carKw=${plan.carKw.toFixed(1)}`,
    `carFrom=${plan.carFrom ?? ""}`,
    `carTo=${plan.carTo ?? ""}`,
    `battery=${plan.battery}`,
    `batteryKw=${plan.batteryKw.toFixed(1)}`,
    `batteryFrom=${plan.batteryFrom ?? ""}`,
    `batteryTo=${plan.batteryTo ?? ""}`,
    `batterySell=${plan.batterySellKw > 0 ? "1" : "0"}`,
    `batterySellFrom=${plan.batterySellFrom ?? ""}`,
    `batterySellTo=${plan.batterySellTo ?? ""}`,
    `batterySellKw=${plan.batterySellKw.toFixed(1)}`,
    `batteryDischargeKw=${plan.batteryDischargeKw.toFixed(2)}`,
    `batteryDischargeFrom=${plan.batteryDischargeFrom ?? ""}`,
    `batteryDischargeTo=${plan.batteryDischargeTo ?? ""}`,
    ""
  ].join("\n");
}
