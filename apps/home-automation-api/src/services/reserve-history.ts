/*
The house reserve for each of the last 30 days.
This is the line that used to sit at 50 percent. Each day keeps the night
above the 20 percent outage floor, and the daylight the sun that morning
was not expected to cover.
*/

import type { PowerReading } from "./house-archive.js";
import { houseLoadForPlan } from "./recent-house-load.js";
import { cloudBand, expectedPvKwh, reserveSocPercent, seasonOf } from "./seasonal-profile.js";
import { addDays, daylightDate } from "./sun-clock.js";

export const RESERVE_HISTORY_DAYS = 30;

export type ReserveDay = {
  date: string;
  reserveSoc: number;
};

/* Reserve for the 30 days ending on this date, oldest first. */
export function reserveHistory(input: {
  endDate: string;
  readDay: (date: string) => PowerReading[];
  morningCloud: (date: string) => number | null;
  tankOn?: (at: string) => boolean;
  carChargeKw?: (at: string) => number;
}): ReserveDay[] {
  const cache = new Map<string, PowerReading[]>();
  const readDay = (date: string) => {
    const stored = cache.get(date);
    if (stored)
      return stored;
    const samples = input.readDay(date);
    cache.set(date, samples);
    return samples;
  };
  const days: ReserveDay[] = [];
  for (let offset = RESERVE_HISTORY_DAYS - 1; offset >= 0; offset -= 1) {
    const date = addDays(input.endDate, -offset);
    const load = houseLoadForPlan({
      planDate: date,
      daylightDate: daylightDate(date, null),
      readDay,
      tankOn: input.tankOn,
      carChargeKw: input.carChargeKw
    });
    const cloud = input.morningCloud(date);
    const expectedPv = cloud === null ? null : expectedPvKwh(seasonOf(date), cloudBand(cloud));
    days.push({
      date,
      reserveSoc: reserveSocPercent(load.nightKwh, load.daylightKwh, expectedPv)
    });
  }
  return days;
}
