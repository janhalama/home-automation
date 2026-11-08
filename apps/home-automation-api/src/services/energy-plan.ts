/*
One plan for the tank, the car, and the home battery.
Hot water finishes by 06:00 on the same day.
Energy stored above 50% goes to the car first. What the car does not take is sold in the expensive hours when that price is at least 3 Kč/kWh above the day's cheapest, and the sale stops at 50%.
The same gap buys a grid charge, but only the room the sun will not fill. After today's expensive hour has passed, tomorrow's sun counts, and the buy waits for the cheaper hour through the next 06:00.
Below that, the car takes leftover sun when the day still covers the house and the car. Otherwise it finishes from the grid by the next 06:00 and may cross midnight.
From the house battery the car takes 6 kW, so the battery can cover it. A grid slot stays at 11 kW. The battery takes the cheapest period long enough, including daytime.
*/

import { cheapestSlot, cheapestSlotAcrossMidnight, type PriceQuarter, type Slot } from "./cheap-slot.js";
import { czkPerKwh, type SpotPrice } from "./ote-day-ahead.js";
import { cloudBand, houseGridKwh, overnightKwh, type Season } from "./seasonal-profile.js";

const TANK_LITERS = 200;
const TANK_TARGET_C = 55;
const WATER_KJ_PER_LITER_K = 4.186;
const TANK_KW = 2.5;
const CAR_KW = 11;
const CAR_FROM_BATTERY_KW = 6;
const HOUSE_KW = 1;
const BREAKER_KW = 17;
const BATTERY_CHARGE_MAX_KW = 3;
const DEADLINE = "06:00";
const SELL_BAND_EUR_PER_MWH = 20;
const SELL_SPREAD_CZK_PER_KWH = 3;
const CZK_PER_EUR = 25;
const SELL_KW = 8;
const UPPER_HALF_SOC = 50;
const PACK_KWH = 19;
const FLOOR_PERCENT = 20;
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
  car: "on" | "off" | "limited" | "surplus" | "battery";
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

/* HH:MM for a minute count, clamped to the day. */
function quarterClock(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, totalMinutes));
  const hour = String(Math.floor(clamped / 60)).padStart(2, "0");
  const minute = String(clamped % 60).padStart(2, "0");
  return `${hour}:${minute}`;
}

/* A block of quarters starting at the current one, long enough for this energy. */
function windowAhead(startAt: string, kwh: number, powerKw: number): Slot | null {
  if (kwh <= 0 || powerKw <= 0)
    return null;
  const [hour, minute] = startAt.split(":");
  const startMin = Math.floor((Number(hour) * 60 + Number(minute)) / 15) * 15;
  const endMin = Math.min(24 * 60, startMin + Math.ceil(kwh / powerKw / 0.25) * 15);
  if (endMin <= startMin)
    return null;
  return { from: quarterClock(startMin), to: quarterClock(endMin) };
}

/* Quarters the slot search can price. */
function priced(prices: SpotPrice[]): PriceQuarter[] {
  return prices.map((price) => ({
    periodInterval: price.periodInterval,
    eurPerMwh: price.eurPerMwh
  }));
}

/* Car slot from now. Tomorrow extends it through the next 06:00. Today alone uses the hours still ahead. */
function carRun(
  today: PriceQuarter[],
  tomorrow: PriceQuarter[] | null,
  missingKwh: number,
  startAt: string | null
): Slot | null {
  if (tomorrow && tomorrow.length > 0 && startAt)
    return cheapestSlotAcrossMidnight(today, tomorrow, missingKwh, CAR_KW, startAt);
  if (startAt)
    return cheapestSlot(today, missingKwh, CAR_KW, null, startAt);
  return cheapestSlot(today, missingKwh, CAR_KW, DEADLINE, null);
}

/* True when the sun still due today covers the house and the car, so no grid slot is bought. */
export function sunCoversCar(input: {
  pvRemainingKwh: number | null;
  season: Season;
  aboveFloorKwh: number | null;
  missingKwh: number;
}): boolean {
  if (input.pvRemainingKwh === null || input.aboveFloorKwh === null)
    return false;
  const houseStill = Math.max(0, overnightKwh(input.season) - input.aboveFloorKwh);
  return input.pvRemainingKwh >= houseStill + input.missingKwh;
}

/* Kč/kWh at the rate that matches Loxone. 100 EUR/MWh is 2.5 Kč/kWh. */
function priceCzk(eurPerMwh: number): number {
  return czkPerKwh(eurPerMwh, CZK_PER_EUR);
}

/* Highest and lowest price of the day, and the quarter where the high sits. */
function priceRange(quarters: PriceQuarter[]): { min: number; max: number; peak: number } | null {
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
  return { min, max, peak };
}

/* True when the expensive hour is at least 3 Kč/kWh above the cheap hour. */
function spreadIsWide(quarters: PriceQuarter[]): boolean {
  const range = priceRange(quarters);
  if (!range)
    return false;
  return priceCzk(range.max) - priceCzk(range.min) >= SELL_SPREAD_CZK_PER_KWH;
}

/* Empty kilowatt-hours up to a full pack. The state of charge wins. The floor figure is the fallback. */
function roomToFullKwh(socPercent: number | null | undefined, aboveFloorKwh: number | null): number | null {
  if (typeof socPercent === "number")
    return Math.max(0, PACK_KWH * (100 - socPercent) / 100);
  if (aboveFloorKwh === null)
    return null;
  const stored = PACK_KWH * FLOOR_PERCENT / 100 + Math.max(0, aboveFloorKwh);
  return Math.max(0, PACK_KWH - stored);
}

/* The run of quarters around the day's highest price, when that peak is at least 3 Kč/kWh above the cheapest. */
function peakSellSlot(quarters: PriceQuarter[]): Slot | null {
  const range = priceRange(quarters);
  if (!range || !spreadIsWide(quarters))
    return null;
  const { max, peak } = range;
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

/* Clock HH:MM to minutes after midnight. */
function clockMinutes(clock: string): number {
  const [hour, minute] = clock.split(":");
  return Number(hour) * 60 + Number(minute);
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
  pvRemainingKwh?: number | null;
  tomorrowPvKwh?: number | null;
  socPercent?: number | null;
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
  const socPercent = input.socPercent;
  const socKnown = typeof socPercent === "number";
  const upperHalf = socKnown && socPercent > UPPER_HALF_SOC;
  const carFromBattery = Boolean(carWanted && upperHalf);
  const sunEnough = carWanted && !carFromBattery && input.car
    ? sunCoversCar({
      pvRemainingKwh: input.pvRemainingKwh ?? null,
      season: input.season,
      aboveFloorKwh: input.aboveFloorKwh,
      missingKwh: input.car.missingKwh
    })
    : false;
  const tomorrow = input.tomorrowPrices ? priced(input.tomorrowPrices) : null;
  const carSlot = carWanted && !carFromBattery && !sunEnough && input.car
    ? carRun(quarters, tomorrow, input.car.missingKwh, input.startAt ?? null)
    : null;
  const car = input.car === null
    ? "limited"
    : !carWanted
      ? "off"
      : carFromBattery
        ? "battery"
        : sunEnough
          ? "surplus"
          : carSlot
            ? "on"
            : "limited";
  const aboveHalfKwh = socKnown ? Math.max(0, (socPercent - UPPER_HALF_SOC) / 100 * PACK_KWH) : 0;
  const carTimes = placed(car === "on"
    ? carSlot
    : car === "battery" && input.startAt
      ? windowAhead(input.startAt, aboveHalfKwh, CAR_FROM_BATTERY_KW)
      : null);

  const batteryPowerKw = batteryChargeKw(tank === "on", car === "on");
  const seasonalKwh = input.lowCloudPercent === null || input.aboveFloorKwh === null
    ? 0
    : houseGridKwh(input.season, cloudBand(input.lowCloudPercent), input.aboveFloorKwh);
  const roomKwh = roomToFullKwh(input.socPercent, input.aboveFloorKwh);
  const pvKnown = typeof input.pvRemainingKwh === "number";
  const peak = peakSellSlot(quarters);
  const peakStillAhead = !input.startAt || !peak || clockMinutes(peak.from) > clockMinutes(input.startAt);
  const todaySun = input.pvRemainingKwh ?? 0;
  const tomorrowSun = typeof input.tomorrowPvKwh === "number" ? input.tomorrowPvKwh : null;
  const sunShortKwh = roomKwh === null || !pvKnown
    ? null
    : peakStillAhead || tomorrowSun === null
      ? Math.max(0, roomKwh - todaySun)
      : Math.max(0, roomKwh - todaySun - tomorrowSun);
  const batteryKwh = spreadIsWide(quarters) && sunShortKwh !== null ? sunShortKwh : seasonalKwh;
  const batterySlot = batteryKwh > 0
    ? input.startAt && tomorrow && tomorrow.length > 0 && !peakStillAhead
      ? cheapestSlotAcrossMidnight(quarters, tomorrow, batteryKwh, batteryPowerKw, input.startAt)
      : cheapestSlot(quarters, batteryKwh, batteryPowerKw, null, input.startAt ?? null)
    : null;
  const batteryTimes = placed(batterySlot);
  const sellEnergy = input.socPercent === undefined
    ? input.aboveFloorKwh !== null && input.aboveFloorKwh > 0
    : upperHalf && !carFromBattery;
  const sellCandidate = sellEnergy ? peakSellSlot(quarters) : null;
  const sellSlot = slotsOverlap(sellCandidate, batterySlot) ? null : sellCandidate;
  const dischargeKw = houseDischargeKw(input.aboveFloorKwh, input.season);

  return {
    tank,
    tankFrom: tankTimes.from,
    tankTo: tankTimes.to,
    car,
    carFrom: carTimes.from,
    carTo: carTimes.to,
    carKw: car === "on" ? CAR_KW : car === "battery" ? CAR_FROM_BATTERY_KW : 0,
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
  const tankFlag = plan.tank === "on" ? "1" : plan.tank === "off" ? "0" : "limited";
  const carFlag = plan.car === "on" ? "1"
    : plan.car === "off" ? "0"
      : plan.car === "surplus" ? "surplus"
        : plan.car === "battery" ? "battery"
          : "limited";
  return [
    `tank=${tankFlag}`,
    `tankFrom=${plan.tankFrom ?? ""}`,
    `tankTo=${plan.tankTo ?? ""}`,
    `car=${carFlag}`,
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
