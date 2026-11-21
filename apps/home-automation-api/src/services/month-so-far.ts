/*
This month's grid purchases and sales, and the sun measured today.
A day with no readings or no euro rate is left out. Each stored sample stands for one quarter-hour of sun.
*/

import { dayBalance } from "./day-balance.js";
import { addDays } from "./sun-clock.js";

const QUARTER_HOURS = 0.25;

type Reading = {
  at: string;
  meterKw: number;
  pvKw?: number | null;
};

type Price = {
  periodInterval: string;
  eurPerMwh: number;
};

export type MonthSoFar = {
  importCzk: number | null;
  exportCzk: number | null;
  productionKwh: number | null;
};

/* Clock HH:MM or HH:MM:SS to minutes after midnight. */
function minutes(clock: string): number {
  const [hour, minute] = clock.split(":");
  return Number(hour) * 60 + Number(minute);
}

/* Price of the 15-minute interval that contains this clock, if one was stored. */
function priceAt(prices: Price[], clock: string): number | null {
  const at = minutes(clock);
  const match = prices.find((price) => {
    const [start, end] = price.periodInterval.split("-");
    const startMinutes = minutes(start);
    let endMinutes = minutes(end);
    if (endMinutes <= startMinutes)
      endMinutes += 24 * 60;
    return at >= startMinutes && at < endMinutes;
  });
  return match ? match.eurPerMwh : null;
}

/* First calendar day of the month that contains this date. */
function monthStart(today: string): string {
  return `${today.slice(0, 7)}-01`;
}

/* Purchases, sales, and today's production. Purchases and sales stay empty until one day is priced. */
export function monthSoFar(input: {
  today: string;
  readDay: (date: string) => Reading[];
  readPrices: (date: string) => Price[];
  czkPerEur: (date: string) => number | null;
}): MonthSoFar {
  let importCzk = 0;
  let exportCzk = 0;
  let pricedDays = 0;
  for (let date = monthStart(input.today); date <= input.today; date = addDays(date, 1)) {
    const rate = input.czkPerEur(date);
    const samples = input.readDay(date);
    if (samples.length === 0 || rate === null)
      continue;
    const money = dayBalance(samples.map((sample) => {
      const time = sample.at.slice(11);
      return {
        time,
        meterKw: sample.meterKw,
        priceEurPerMwh: priceAt(input.readPrices(date), time),
        pvKw: sample.pvKw
      };
    }), rate);
    importCzk += money.importCzk;
    exportCzk += money.exportCzk;
    pricedDays += 1;
  }
  const todaySamples = input.readDay(input.today);
  return {
    importCzk: pricedDays === 0 ? null : importCzk,
    exportCzk: pricedDays === 0 ? null : exportCzk,
    productionKwh: todaySamples.length === 0
      ? null
      : todaySamples.reduce((sum, sample) => sum + Math.max(0, sample.pvKw ?? 0) * QUARTER_HOURS, 0)
  };
}
