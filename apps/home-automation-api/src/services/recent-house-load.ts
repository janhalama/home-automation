/*
House load for the plan from the last week of quarter-hour samples.
The tank is 2.5 kW while its relay was on. The car is the TeslaMate charge
power. Energy going into the home battery is already out of the sample,
because battery power is negative while it charges.
A week with no complete side still uses the seasonal table.
*/

import type { HeatingPeriod, PowerReading } from "./house-archive.js";
import { fortnightNightKwh, seasonalDaylightKwh, seasonOf } from "./seasonal-profile.js";
import { addDays, sunClocks, weekday } from "./sun-clock.js";

export const HOUSE_LOAD_DAYS = 7;

const TANK_KW = 2.5;

export type HouseLoad = {
  nightKwh: number;
  daylightKwh: number;
};

/* True while a saved heater period covers this timestamp. */
export function heaterIsOn(periods: HeatingPeriod[], at: string): boolean {
  return periods.some((period) => period.startedAt <= at && (period.endedAt === null || at < period.endedAt));
}

/* Middle value of a list. An empty list has no median. */
function median(values: number[]): number | null {
  if (values.length === 0)
    return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1)
    return ordered[middle];
  return (ordered[middle - 1] + ordered[middle]) / 2;
}

/* Minutes after midnight for HH:MM or HH:MM:SS. */
function minutes(clock: string): number {
  const [hour, minute] = clock.split(":");
  return Number(hour) * 60 + Number(minute);
}

/* Clock on a Prague timestamp, or null when the stamp is not on that date. */
function clockOf(at: string, date: string): string | null {
  if (!at.startsWith(date))
    return null;
  const time = at.slice(11, 19);
  if (!/^\d{2}:\d{2}/.test(time))
    return null;
  return time.length === 5 ? `${time}:00` : time;
}

/* House kilowatts left after the relay's 2.5 kW and the car's charge power. */
function houseKw(sample: PowerReading, tankOn: boolean, carKw: number): number {
  const tank = sample.tankKw ?? (tankOn ? TANK_KW : 0);
  const car = sample.carChargeKw ?? carKw;
  return Math.max(0, sample.pvKw - sample.meterKw + sample.batteryKw - tank - car);
}

/* House energy in one window. */
function houseEnergy(
  samples: PowerReading[],
  date: string,
  start: string,
  end: string,
  tankOn: (at: string) => boolean,
  carChargeKw: (at: string) => number
): number | null {
  const points = samples
    .map((sample) => {
      const clock = clockOf(sample.at, date);
      if (!clock)
        return null;
      return { minute: minutes(clock), rate: houseKw(sample, tankOn(sample.at), carChargeKw(sample.at)) };
    })
    .filter((point): point is { minute: number; rate: number } => point !== null)
    .sort((left, right) => left.minute - right.minute);
  const startMin = minutes(start);
  const endMin = minutes(end);
  const span = endMin - startMin;
  if (span <= 0)
    return null;
  let covered = 0;
  let energy = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const left = points[index];
    const right = points[index + 1];
    if (left.minute < startMin || left.minute >= endMin)
      continue;
    const hours = (right.minute - left.minute) / 60;
    if (hours <= 0 || hours > 0.5)
      continue;
    covered += right.minute - left.minute;
    energy += (left.rate + right.rate) / 2 * hours;
  }
  if (covered / span < 0.8)
    return null;
  return energy;
}

/* Quiet daylight and the house-only night for one archive day. */
function dayEnergies(
  samples: PowerReading[],
  date: string,
  tankOn: (at: string) => boolean,
  carChargeKw: (at: string) => number
): { day: number | null; night: number | null } {
  const sun = sunClocks(date);
  const day = houseEnergy(samples, date, sun.rise, sun.set, tankOn, carChargeKw);
  const early = houseEnergy(samples, date, "00:00:00", sun.rise, tankOn, carChargeKw);
  const late = houseEnergy(samples, date, sun.set, "24:00:00", tankOn, carChargeKw);
  const night = early === null || late === null ? null : early + late;
  return { day, night };
}

/* The seven completed dates before this one. */
function recentDates(date: string): string[] {
  return Array.from({ length: HOUSE_LOAD_DAYS }, (_, index) => addDays(date, -(index + 1)));
}

/* Median house kilowatts for each clock hour in the last week. */
export function houseKwByHour(input: {
  planDate: string;
  readDay: (date: string) => PowerReading[];
  tankOn?: (at: string) => boolean;
  carChargeKw?: (at: string) => number;
}): Map<string, number> {
  const tankOn = input.tankOn ?? (() => false);
  const carChargeKw = input.carChargeKw ?? (() => 0);
  const buckets = new Map<string, number[]>();
  for (const date of recentDates(input.planDate)) {
    for (const sample of input.readDay(date)) {
      const clock = clockOf(sample.at, date);
      if (!clock)
        continue;
      const hour = clock.slice(0, 2);
      const rates = buckets.get(hour) ?? [];
      rates.push(houseKw(sample, tankOn(sample.at), carChargeKw(sample.at)));
      buckets.set(hour, rates);
    }
  }
  const byHour = new Map<string, number>();
  for (const [hour, rates] of buckets) {
    const middle = median(rates);
    if (middle !== null)
      byHour.set(hour, middle);
  }
  return byHour;
}

/* The completed dates the reserve reads for this plan. */
export function houseLoadDates(planDate: string, daylightDate: string): string[] {
  return [...new Set([...recentDates(planDate), ...recentDates(daylightDate)])];
}

/* Night and daylight kilowatt-hours the reserve uses for this plan. */
export function houseLoadForPlan(input: {
  planDate: string;
  daylightDate: string;
  readDay: (date: string) => PowerReading[];
  tankOn?: (at: string) => boolean;
  carChargeKw?: (at: string) => number;
}): HouseLoad {
  const tankOn = input.tankOn ?? (() => false);
  const carChargeKw = input.carChargeKw ?? (() => 0);
  const nights: number[] = [];
  for (const date of recentDates(input.planDate)) {
    const night = dayEnergies(input.readDay(date), date, tankOn, carChargeKw).night;
    if (night !== null)
      nights.push(night);
  }
  const weekend = weekday(input.daylightDate) === 0 || weekday(input.daylightDate) === 6;
  const days: number[] = [];
  for (const date of recentDates(input.daylightDate)) {
    const day = weekday(date);
    const isWeekend = day === 0 || day === 6;
    if (isWeekend !== weekend)
      continue;
    const energy = dayEnergies(input.readDay(date), date, tankOn, carChargeKw).day;
    if (energy !== null)
      days.push(energy);
  }
  const nightMedian = median(nights);
  const dayMedian = median(days);
  return {
    nightKwh: nightMedian ?? fortnightNightKwh(input.planDate),
    daylightKwh: dayMedian ?? seasonalDaylightKwh(seasonOf(input.daylightDate), weekend)
  };
}
