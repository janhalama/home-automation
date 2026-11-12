/*
One plan for the tank, the car, and the home battery.
Hot water finishes by 06:00 on the same day.
Energy above the house reserve is sold when the day's peak is at least 3 Kč/kWh above the cheapest hour, and the car is bought in that cheap hour instead. The reserve still covers the night. A grid buy lasts only as long as the battery needs to take on the missing energy. The sale is planned from that buy: the energy it adds, minus the house use during the peak. What remains above the reserve is sold. The car takes the battery only when the day is too flat to be worth a grid slot. It does not start during the expensive hours. The reserve is the 20% outage floor plus the night, plus the daylight the expected sun will not cover. The sale stops at the reserve.
While the next high price is still ahead, the charge finishes before that rise. The rise is the one that holds the highest quarter still to come. After that rise has ended, the next poll books the same kind of window before the following rise, including the cheap evening before the next morning. A day with no rise keeps the cheapest block.
Below that, the car takes leftover sun when the day still covers the house and the car. Otherwise the grid charge reaches 35% by 06:00. It continues to the car's own limit in that same morning only when those hours are the cheapest. It may cross midnight.
From the house battery the car takes 6 kW, so the battery can cover it. A grid slot stays at 11 kW. The battery takes the cheapest period long enough, including daytime.
*/

import { morningCarKwh } from "./car-energy.js";
import { cheapestSlot, cheapestSlotAcrossMidnight, cheapestSlotUntil, type PriceQuarter, type Slot } from "./cheap-slot.js";
import { czkPerKwh, type SpotPrice } from "./ote-day-ahead.js";
import { nextPriceRise, type PriceRise } from "./price-rise.js";
import { overnightKwh, reserveSocPercent, type Season } from "./seasonal-profile.js";
import { addDays, sunClocks } from "./sun-clock.js";

const TANK_LITERS = 200;
const TANK_TARGET_C = 55;
const WATER_KJ_PER_LITER_K = 4.186;
const TANK_KW = 2.5;
const CAR_KW = 11;
const CAR_FROM_BATTERY_KW = 6;
const HOUSE_KW = 1;
const BREAKER_KW = 17;
const BATTERY_CHARGE_MAX_KW = 6;
const DEADLINE = "06:00";
const SELL_BAND_EUR_PER_MWH = 20;
const SELL_SPREAD_CZK_PER_KWH = 3;
const HOUSE_GAP_CZK = 2;
const CZK_PER_EUR = 25;
const SELL_KW = 8;
const PACK_KWH = 19;
const FLOOR_PERCENT = 20;
const DISCHARGE_FROM = "18:00";
const DISCHARGE_TO = "06:00";
const DISCHARGE_HOURS = 12;

export type CarJob = {
  missingKwh: number;
  usablePercent?: number;
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
  batteryHoldFrom: string | null;
  batteryHoldTo: string | null;
  reserveSoc: number;
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

/* Power left for the home battery. The cap is 6 kW, half of the 12 kW the battery can take. The breaker cuts that only while the car, or the car and the tank, are actually on. */
function batteryChargeKw(tankOn: boolean, carOn: boolean): number {
  const taken = HOUSE_KW + (tankOn ? TANK_KW : 0) + (carOn ? CAR_KW : 0);
  const room = BREAKER_KW - taken;
  if (room <= 0)
    return 0;
  return Math.min(BATTERY_CHARGE_MAX_KW, room);
}

/* True when every minute of the inner slot sits inside the outer one. */
function slotCoveredBy(inner: Slot, outer: Slot | null): boolean {
  if (!outer)
    return false;
  const start = clockMinutes(inner.from);
  const end = clockMinutes(inner.to);
  const from = clockMinutes(outer.from);
  const to = clockMinutes(outer.to);
  if (to <= from || end <= start)
    return false;
  return start >= from && end <= to;
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

/* True when the clock sits inside the slot. The end minute is excluded. */
function clockInside(clock: string, from: string, to: string): boolean {
  const at = clockMinutes(clock);
  const start = clockMinutes(from);
  const end = clockMinutes(to);
  if (start === end)
    return false;
  if (end > start)
    return at >= start && at < end;
  return at >= start || at < end;
}

/* Tank window. One that has started keeps its hours, so a warmer reading cannot turn the relay off. After it has ended, the next window may cross midnight. */
function tankPlanSlot(
  today: PriceQuarter[],
  tomorrow: PriceQuarter[] | null,
  currentC: number | null,
  openingC: number | null,
  startAt: string | null
): Slot | null {
  if (currentC === null || currentC >= TANK_TARGET_C)
    return null;
  const sizingC = openingC === null ? currentC : Math.min(openingC, currentC);
  const morning = cheapestSlot(today, tankEnergyKwh(sizingC), TANK_KW, DEADLINE, null);
  if (!startAt)
    return morning;
  if (morning && (clockInside(startAt, morning.from, morning.to) || clockMinutes(startAt) < clockMinutes(morning.from)))
    return morning;
  const remaining = tankEnergyKwh(currentC);
  if (tomorrow && tomorrow.length > 0)
    return cheapestSlotAcrossMidnight(today, tomorrow, remaining, TANK_KW, startAt);
  return cheapestSlot(today, remaining, TANK_KW, null, startAt);
}

/* The largest multiple of one quarter, up to kwh, that still fits before endBy. */
function fittedKwh(
  today: PriceQuarter[],
  kwh: number,
  endBy: string,
  startAt: string | null
): number {
  const step = CAR_KW * 0.25;
  let energy = Math.ceil(kwh / step) * step;
  while (energy > 0) {
    if (cheapestSlot(today, energy, CAR_KW, endBy, startAt))
      return energy;
    energy -= step;
  }
  return 0;
}

/* Mean price of the quarters inside a slot. A slot that passes midnight uses tomorrow. */
function meanSlotPrice(today: PriceQuarter[], tomorrow: PriceQuarter[] | null, slot: Slot): number | null {
  const slotStart = clockMinutes(slot.from);
  const slotEnd = clockMinutes(slot.to) + (clockMinutes(slot.to) <= slotStart ? 24 * 60 : 0);
  const chosen = [...today, ...(tomorrow ?? [])].filter((quarter, index) => {
    const day = index < today.length ? 0 : 1;
    const [from, to] = quarter.periodInterval.split("-");
    const start = clockMinutes(from) + day * 24 * 60;
    const end = clockMinutes(to) + day * 24 * 60;
    return start < slotEnd && end > slotStart;
  });
  if (chosen.length === 0)
    return null;
  return chosen.reduce((sum, quarter) => sum + quarter.eurPerMwh, 0) / chosen.length;
}

/* Cheapest run for the energy that can wait until after 06:00. */
function laterCarSlot(
  today: PriceQuarter[],
  tomorrow: PriceQuarter[] | null,
  kwh: number
): Slot | null {
  if (kwh <= 0)
    return null;
  if (tomorrow && tomorrow.length > 0)
    return cheapestSlotUntil(today, tomorrow, kwh, CAR_KW, DEADLINE, DEADLINE);
  return cheapestSlot(today, kwh, CAR_KW, null, DEADLINE);
}

/* Car slot. The 35% floor is bought in the cheapest hours that finish by the next 06:00, and the limit only when that stretch is cheapest. */
function carRun(
  today: PriceQuarter[],
  tomorrow: PriceQuarter[] | null,
  missingKwh: number,
  usablePercent: number | null,
  startAt: string | null
): Slot | null {
  if (usablePercent === null || missingKwh <= 0)
    return carRunOpen(today, tomorrow, missingKwh, startAt);
  const { floorKwh, limitKwh } = morningCarKwh(usablePercent, missingKwh);
  const beforeMorning = startAt === null || clockMinutes(startAt) < clockMinutes(DEADLINE);
  if (!beforeMorning)
    return carRunOpen(today, tomorrow, limitKwh, startAt);
  const morningLimit = fittedKwh(today, limitKwh, DEADLINE, startAt);
  const morningFloor = fittedKwh(today, floorKwh, DEADLINE, startAt);
  const morningFull = morningLimit > 0
    ? cheapestSlot(today, morningLimit, CAR_KW, DEADLINE, startAt)
    : null;
  const extraKwh = Math.max(0, limitKwh - floorKwh);
  const later = laterCarSlot(today, tomorrow, floorKwh > 0 ? extraKwh : limitKwh);
  const morningMean = morningFull ? meanSlotPrice(today, tomorrow, morningFull) : null;
  const laterMean = later ? meanSlotPrice(today, tomorrow, later) : null;
  const morningIsBest = laterMean === null || (morningMean !== null && morningMean <= laterMean);
  const wanted = morningIsBest ? morningLimit : morningFloor;
  if (wanted <= 0)
    return floorKwh <= 0 ? later : null;
  return cheapestSlot(today, wanted, CAR_KW, DEADLINE, startAt);
}

/* Car slot with no morning floor. Before 06:00 it still finishes by 06:00. */
function carRunOpen(
  today: PriceQuarter[],
  tomorrow: PriceQuarter[] | null,
  missingKwh: number,
  startAt: string | null
): Slot | null {
  if (startAt && clockMinutes(startAt) < clockMinutes(DEADLINE))
    return cheapestSlot(today, missingKwh, CAR_KW, DEADLINE, startAt);
  if (tomorrow && tomorrow.length > 0 && startAt)
    return cheapestSlotAcrossMidnight(today, tomorrow, missingKwh, CAR_KW, startAt);
  if (startAt)
    return cheapestSlot(today, missingKwh, CAR_KW, null, startAt);
  return cheapestSlot(today, missingKwh, CAR_KW, DEADLINE, null);
}

/* A manual charge from this clock, at the wallbox cap, long enough for the missing energy. */
export function chargeCarNow(startAt: string, missingKwh: number): Slot | null {
  return windowAhead(startAt, missingKwh, CAR_KW);
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

/* Kč/kWh between the dearest and the cheapest quarter. */
function gapCzk(quarters: PriceQuarter[]): number | null {
  const range = priceRange(quarters);
  if (!range)
    return null;
  return priceCzk(range.max) - priceCzk(range.min);
}

/* True when the expensive hour is at least 3 Kč/kWh above the cheap hour. */
function spreadIsWide(quarters: PriceQuarter[]): boolean {
  const gap = gapCzk(quarters);
  return gap !== null && gap >= SELL_SPREAD_CZK_PER_KWH;
}

/* Quarters the battery buy can still use. Tomorrow counts only through 06:00. */
function quartersForBuy(
  today: PriceQuarter[],
  tomorrow: PriceQuarter[],
  date: string,
  startAt: string | null,
  crossesMidnight: boolean
): Array<PriceQuarter & { date: string }> {
  const startMin = startAt === null ? null : clockMinutes(startAt);
  const open = today
    .filter((quarter) => startMin === null || clockMinutes(quarter.periodInterval.split("-")[1]) > startMin)
    .map((quarter) => ({ ...quarter, date }));
  if (!crossesMidnight)
    return open;
  const morning = tomorrow
    .filter((quarter) => clockMinutes(quarter.periodInterval.split("-")[1]) <= clockMinutes("06:00"))
    .map((quarter) => ({ ...quarter, date: addDays(date, 1) }));
  return [...open, ...morning];
}

/* House energy that falls in quarters more than 2 Kč/kWh above the cheapest. */
function expensiveHouseKwh(
  quarters: Array<PriceQuarter & { date: string }>,
  nightKwh: number,
  daylightKwh: number
): number {
  const range = priceRange(quarters);
  if (!range)
    return 0;
  let energy = 0;
  for (const quarter of quarters) {
    if (priceCzk(quarter.eurPerMwh) - priceCzk(range.min) <= HOUSE_GAP_CZK)
      continue;
    const start = quarter.periodInterval.split("-")[0];
    const sun = sunClocks(quarter.date);
    const dayHours = (clockMinutes(sun.set) - clockMinutes(sun.rise)) / 60;
    const nightHours = 24 - dayHours;
    const inDaylight = start >= sun.rise.slice(0, 5) && start < sun.set.slice(0, 5);
    const rate = inDaylight
      ? dayHours > 0 ? daylightKwh / dayHours : 0
      : nightHours > 0 ? nightKwh / nightHours : 0;
    energy += 0.25 * rate;
  }
  return energy;
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

/* Hours of a same-day slot that finish before this clock. A charge after the peak does not count. */
function hoursBefore(slot: Slot, before: string): number {
  const start = clockMinutes(slot.from);
  const end = clockMinutes(slot.to);
  const limit = clockMinutes(before);
  if (end <= start)
    return 0;
  if (end <= limit)
    return (end - start) / 60;
  if (start >= limit)
    return 0;
  return (limit - start) / 60;
}

/* Share of the remaining sun that lands before the peak. Sun after the peak cannot be sold then. */
function sunBeforePeakKwh(pvKwh: number, date: string, peakFrom: string, startAt: string | null): number {
  const sun = sunClocks(date);
  const rise = clockMinutes(sun.rise);
  const set = clockMinutes(sun.set);
  const peak = clockMinutes(peakFrom);
  const start = startAt === null ? rise : Math.max(clockMinutes(startAt), rise);
  if (set <= start)
    return 0;
  const until = Math.min(peak, set);
  if (until <= start)
    return 0;
  return pvKwh * (until - start) / (set - start);
}

/* Kilowatt-hours the planned charge puts in the pack before the peak. Room in the pack wins. */
function chargeGainBeforePeak(
  slot: Slot | null,
  powerKw: number,
  wantedKwh: number,
  roomKwh: number | null,
  peakFrom: string
): number {
  if (!slot || powerKw <= 0 || wantedKwh <= 0)
    return 0;
  const delivered = Math.min(wantedKwh, powerKw * hoursBefore(slot, peakFrom));
  if (roomKwh === null)
    return delivered;
  return Math.min(delivered, Math.max(0, roomKwh));
}

/* House energy in the peak slot, from the night rate or the daylight rate. */
function houseKwhInSlot(
  quarters: PriceQuarter[],
  slot: Slot,
  date: string,
  nightKwh: number,
  daylightKwh: number
): number {
  let energy = 0;
  for (const quarter of quarters) {
    const start = quarter.periodInterval.split("-")[0];
    if (!clockInside(start, slot.from, slot.to))
      continue;
    const sun = sunClocks(date);
    const dayHours = (clockMinutes(sun.set.slice(0, 5)) - clockMinutes(sun.rise.slice(0, 5))) / 60;
    const nightHours = 24 - dayHours;
    const inDaylight = start >= sun.rise.slice(0, 5) && start < sun.set.slice(0, 5);
    const rate = inDaylight
      ? dayHours > 0 ? daylightKwh / dayHours : 0
      : nightHours > 0 ? nightKwh / nightHours : 0;
    energy += 0.25 * rate;
  }
  return energy;
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

const RISE_LOOKAHEAD = "12:00";

type AheadQuarter = PriceQuarter & { day: number };

/* Quarters still ahead, plus tomorrow through late morning so the next rise is visible. */
function quartersAhead(
  today: PriceQuarter[],
  tomorrow: PriceQuarter[] | null,
  startAt: string | null
): AheadQuarter[] {
  const startMin = startAt === null ? null : clockMinutes(startAt);
  const open = today
    .filter((quarter) => startMin === null || clockMinutes(quarter.periodInterval.split("-")[1]) > startMin)
    .map((quarter) => ({ ...quarter, day: 0 }));
  const morning = (tomorrow ?? [])
    .filter((quarter) => clockMinutes(quarter.periodInterval.split("-")[1]) <= clockMinutes(RISE_LOOKAHEAD))
    .map((quarter) => ({ ...quarter, day: 1 }));
  return [...open, ...morning];
}

/* The rise that holds the highest quarter, or null when the high sits before any rise. */
function riseAroundMax(quarters: AheadQuarter[]): (PriceRise & { day: number }) | null {
  if (quarters.length === 0)
    return null;
  let maxIndex = 0;
  quarters.forEach((quarter, index) => {
    if (quarter.eurPerMwh > quarters[maxIndex].eurPerMwh)
      maxIndex = index;
  });
  let fromIndex = 0;
  while (fromIndex < quarters.length) {
    const rise = nextPriceRise(quarters.slice(fromIndex));
    if (!rise)
      return null;
    const startIndex = fromIndex + quarters.slice(fromIndex).findIndex((quarter) => quarter.periodInterval.startsWith(rise.from));
    if (startIndex < fromIndex)
      return null;
    const deadline = rise.to;
    const endIndex = deadline === null
      ? quarters.length
      : startIndex + quarters.slice(startIndex).findIndex((quarter) => quarter.periodInterval.startsWith(`${deadline}-`) || quarter.periodInterval.startsWith(deadline));
    const end = endIndex < startIndex ? quarters.length : endIndex;
    if (maxIndex >= startIndex && maxIndex < end)
      return { ...rise, day: quarters[startIndex].day };
    fromIndex = Math.max(end, startIndex + 1);
  }
  return null;
}

/* Kilowatt-hours of the wanted buy that finish by this clock, today or on the next morning. */
function kwhBeforeRise(
  today: PriceQuarter[],
  tomorrow: PriceQuarter[] | null,
  kwh: number,
  powerKw: number,
  endAt: string,
  endDay: number,
  startAt: string | null
): number {
  const start = startAt === null ? null : clockMinutes(startAt);
  const end = clockMinutes(endAt);
  let count = 0;
  for (const quarter of today) {
    const to = clockMinutes(quarter.periodInterval.split("-")[1]);
    if ((start === null || to > start) && (endDay === 1 || to <= end))
      count += 1;
  }
  if (endDay === 1)
    for (const quarter of tomorrow ?? []) {
      const to = clockMinutes(quarter.periodInterval.split("-")[1]);
      if (to <= end)
        count += 1;
    }
  return Math.min(kwh, count * 0.25 * powerKw);
}

/* True when this clock sits inside the rise. A rise that reaches the next day includes the late hours. */
function insideRise(startAt: string, rise: PriceRise): boolean {
  const at = clockMinutes(startAt);
  const from = clockMinutes(rise.from);
  const to = rise.to === null ? 24 * 60 : clockMinutes(rise.to);
  if (to > from)
    return at >= from && at < to;
  return at >= from || at < to;
}

/* Build the three lines from prices and the readings the API already has. */
export function buildEnergyPlan(input: {
  prices: SpotPrice[];
  tomorrowPrices?: SpotPrice[];
  startAt?: string | null;
  bottomTemperatureC: number | null;
  openingTemperatureC?: number | null;
  aboveFloorKwh: number | null;
  date: string;
  nightHouseKwh: number;
  daylightHouseKwh: number;
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
  const tankSlot = tankPlanSlot(
    quarters,
    input.tomorrowPrices && input.tomorrowPrices.length > 0 ? priced(input.tomorrowPrices) : null,
    input.bottomTemperatureC,
    input.openingTemperatureC ?? null,
    input.startAt ?? null
  );
  const needsTank = input.bottomTemperatureC !== null && input.bottomTemperatureC < TANK_TARGET_C;
  const tank = input.bottomTemperatureC === null ? "limited" : needsTank ? tankSlot ? "on" : "limited" : "off";
  const tankTimes = placed(tank === "on" ? tankSlot : null);

  const carWanted = input.car !== null && input.car.atHome && input.car.missingKwh > 0;
  const socPercent = input.socPercent;
  const socKnown = typeof socPercent === "number";
  const peak = peakSellSlot(quarters);
  const peakStillAhead = !input.startAt || !peak || clockMinutes(peak.from) > clockMinutes(input.startAt);
  const pvKnown = typeof input.pvRemainingKwh === "number";
  const todaySun = input.pvRemainingKwh ?? 0;
  const tomorrowSun = typeof input.tomorrowPvKwh === "number" ? input.tomorrowPvKwh : null;
  const sunForHouse = !pvKnown ? null : peakStillAhead || tomorrowSun === null ? todaySun : todaySun + tomorrowSun;
  const tomorrow = input.tomorrowPrices && input.tomorrowPrices.length > 0 ? priced(input.tomorrowPrices) : null;
  const reserveSoc = reserveSocPercent(input.nightHouseKwh, input.daylightHouseKwh, sunForHouse);
  const upperHalf = socKnown && socPercent > reserveSoc;
  const sellBeatsCar = spreadIsWide(quarters) && peak !== null;
  const carFromBattery = Boolean(carWanted && upperHalf && !sellBeatsCar);
  const sunEnough = carWanted && !carFromBattery && input.car
    ? sunCoversCar({
      pvRemainingKwh: input.pvRemainingKwh ?? null,
      season: input.season,
      aboveFloorKwh: input.aboveFloorKwh,
      missingKwh: input.car.missingKwh
    })
    : false;
  const carSlot = carWanted && !carFromBattery && !sunEnough && input.car
    ? carRun(quarters, tomorrow, input.car.missingKwh, input.car.usablePercent ?? null, input.startAt ?? null)
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
          : "off";
  const aboveHalfKwh = socKnown ? Math.max(0, (socPercent - reserveSoc) / 100 * PACK_KWH) : 0;
  const carTimes = placed(car === "on"
    ? carSlot
    : car === "battery" && input.startAt
      ? windowAhead(input.startAt, aboveHalfKwh, CAR_FROM_BATTERY_KW)
      : null);

  let batteryPowerKw = BATTERY_CHARGE_MAX_KW;
  const roomKwh = roomToFullKwh(input.socPercent, input.aboveFloorKwh);
  const sunShortKwh = roomKwh === null || !pvKnown
    ? null
    : peakStillAhead || tomorrowSun === null
      ? Math.max(0, roomKwh - todaySun)
      : Math.max(0, roomKwh - todaySun - tomorrowSun);
  const crossesMidnight = Boolean(input.startAt) && tomorrow !== null && !peakStillAhead;
  const slotQuarters = quartersForBuy(quarters, tomorrow ?? [], input.date, input.startAt ?? null, crossesMidnight);
  const gap = gapCzk(slotQuarters);
  const tradingKwh = spreadIsWide(quarters) && sunShortKwh !== null ? sunShortKwh : 0;
  const houseNeed = input.nightHouseKwh + input.daylightHouseKwh;
  const uncovered = sunForHouse === null ? houseNeed : Math.max(0, houseNeed - sunForHouse);
  const expensive = expensiveHouseKwh(slotQuarters, input.nightHouseKwh, input.daylightHouseKwh);
  const available = input.aboveFloorKwh === null ? null : Math.max(0, input.aboveFloorKwh);
  const houseKwh = gap !== null && gap > HOUSE_GAP_CZK && available !== null && available < expensive
    ? Math.min(uncovered, expensive - available)
    : 0;
  const laterKwh = Math.max(tradingKwh, houseKwh);
  const peakForSale = peakStillAhead ? peak : null;
  const storedKwh = socKnown
    ? socPercent / 100 * PACK_KWH
    : input.aboveFloorKwh === null
      ? null
      : PACK_KWH * FLOOR_PERCENT / 100 + input.aboveFloorKwh;
  const peakUseKwh = peakForSale
    ? houseKwhInSlot(quarters, peakForSale, input.date, input.nightHouseKwh, input.daylightHouseKwh)
    : 0;
  const reserveKwh = reserveSoc / 100 * PACK_KWH;
  const sunEarly = peakForSale && pvKnown
    ? sunBeforePeakKwh(todaySun, input.date, peakForSale.from, input.startAt ?? null)
    : 0;
  const coverKwh = storedKwh !== null && gap !== null && gap > HOUSE_GAP_CZK
    ? Math.max(0, reserveKwh + peakUseKwh - storedKwh - sunEarly)
    : 0;
  const roomAfterSun = roomKwh === null ? 0 : Math.max(0, roomKwh - sunEarly);
  const saleKwh = peakForSale && spreadIsWide(quarters) ? roomAfterSun : 0;
  const aheadKwh = Math.max(coverKwh, saleKwh);
  const buyForPeak = aheadKwh > laterKwh && peakForSale !== null;
  const chargeKwh = buyForPeak ? aheadKwh : laterKwh;
  const tankWindow = tank === "on" ? tankSlot : null;
  const carWindow = car === "on" ? carSlot : null;
  const todayRise = riseAroundMax(quarters.map((quarter) => ({ ...quarter, day: 0 })));
  const inside = Boolean(input.startAt && todayRise && insideRise(input.startAt, todayRise));
  const nextRise = inside ? null : riseAroundMax(quartersAhead(quarters, tomorrow, input.startAt ?? null));
  const laterSlot = () => laterKwh > 0
    ? input.startAt && tomorrow && tomorrow.length > 0 && !peakStillAhead
      ? cheapestSlotAcrossMidnight(quarters, tomorrow, laterKwh, batteryPowerKw, input.startAt)
      : cheapestSlot(quarters, laterKwh, batteryPowerKw, null, input.startAt ?? null)
    : null;
  let batterySlot: Slot | null = null;
  if (!inside && nextRise && chargeKwh > 0) {
    const fitted = kwhBeforeRise(quarters, tomorrow, chargeKwh, batteryPowerKw, nextRise.from, nextRise.day, input.startAt ?? null);
    if (fitted > 0)
      batterySlot = nextRise.day === 1 && tomorrow
        ? cheapestSlotUntil(quarters, tomorrow, fitted, batteryPowerKw, input.startAt ?? "00:00", nextRise.from)
        : cheapestSlot(quarters, fitted, batteryPowerKw, nextRise.from, input.startAt ?? null);
    if (batterySlot && slotCoveredBy(batterySlot, carWindow)) {
      const reducedKw = batteryChargeKw(slotCoveredBy(batterySlot, tankWindow), true);
      const refit = kwhBeforeRise(quarters, tomorrow, chargeKwh, reducedKw, nextRise.from, nextRise.day, input.startAt ?? null);
      const refitSlot = refit > 0
        ? nextRise.day === 1 && tomorrow
          ? cheapestSlotUntil(quarters, tomorrow, refit, reducedKw, input.startAt ?? "00:00", nextRise.from)
          : cheapestSlot(quarters, refit, reducedKw, nextRise.from, input.startAt ?? null)
        : null;
      if (refitSlot && slotCoveredBy(refitSlot, carWindow)) {
        batteryPowerKw = reducedKw;
        batterySlot = refitSlot;
      }
    }
  }
  if (!batterySlot && !inside)
    batterySlot = laterSlot();
  const batteryTimes = placed(batterySlot);
  const gridGain = peakForSale
    ? chargeGainBeforePeak(batterySlot, batteryPowerKw, chargeKwh, roomKwh, peakForSale.from)
    : 0;
  const gainKwh = roomKwh === null ? gridGain : Math.min(roomKwh, gridGain + sunEarly);
  const sellableKwh = storedKwh === null ? null : Math.min(PACK_KWH, storedKwh + gainKwh) - peakUseKwh - reserveKwh;
  const sellEnergy = peakForSale === null
    ? false
    : !socKnown
      ? input.aboveFloorKwh !== null && input.aboveFloorKwh > 0
      : (sellableKwh ?? 0) > 0 && !carFromBattery;
  const sellCandidate = sellEnergy ? peakForSale : null;
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
    batteryDischargeTo: dischargeKw > 0 ? DISCHARGE_TO : null,
    batteryHoldFrom: null,
    batteryHoldTo: null,
    reserveSoc
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
    `batteryHold=${plan.batteryHoldFrom ? "1" : "0"}`,
    `batteryHoldFrom=${plan.batteryHoldFrom ?? ""}`,
    `batteryHoldTo=${plan.batteryHoldTo ?? ""}`,
    `reserveSoc=${plan.reserveSoc.toFixed(1)}`,
    ""
  ].join("\n");
}
