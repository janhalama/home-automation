/*
Grid money for each of the last 30 days.
Each day uses the euro rate in force that day. A day with no readings stays empty.
*/

import { dayBalance } from "./day-balance.js";
import { addDays } from "./sun-clock.js";

export const BALANCE_HISTORY_DAYS = 30;

export type BalanceDay = {
  date: string;
  czkPerEur: number | null;
  importCzk: number | null;
  exportCzk: number | null;
  balanceCzk: number | null;
  houseCzk: number | null;
  batteryCzk: number | null;
  carCzk: number | null;
  tankCzk: number | null;
  sunCzk: number | null;
};

type Reading = {
  at: string;
  meterKw: number;
  pvKw?: number | null;
  batteryKw?: number | null;
  carChargeKw?: number | null;
  tankKw?: number | null;
};

type Price = {
  periodInterval: string;
  eurPerMwh: number;
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

/* Money for the 30 days ending on this date, oldest first. */
export function balanceHistory(input: {
  endDate: string;
  readDay: (date: string) => Reading[];
  readPrices: (date: string) => Price[];
  czkPerEur: (date: string) => number | null;
}): BalanceDay[] {
  const days: BalanceDay[] = [];
  for (let offset = BALANCE_HISTORY_DAYS - 1; offset >= 0; offset -= 1) {
    const date = addDays(input.endDate, -offset);
    const rate = input.czkPerEur(date);
    const samples = input.readDay(date);
    const empty = {
      date,
      czkPerEur: rate,
      importCzk: null,
      exportCzk: null,
      balanceCzk: null,
      houseCzk: null,
      batteryCzk: null,
      carCzk: null,
      tankCzk: null,
      sunCzk: null
    };
    if (samples.length === 0 || rate === null) {
      days.push(empty);
      continue;
    }
    const prices = input.readPrices(date);
    const money = dayBalance(samples.map((sample) => {
      const time = sample.at.slice(11);
      return {
        time,
        meterKw: sample.meterKw,
        priceEurPerMwh: priceAt(prices, time),
        pvKw: sample.pvKw,
        batteryKw: sample.batteryKw,
        carKw: sample.carChargeKw,
        tankKw: sample.tankKw
      };
    }), rate);
    days.push({
      date,
      czkPerEur: rate,
      importCzk: money.importCzk,
      exportCzk: money.exportCzk,
      balanceCzk: money.balanceCzk,
      houseCzk: money.houseCzk,
      batteryCzk: money.batteryCzk,
      carCzk: money.carCzk,
      tankCzk: money.tankCzk,
      sunCzk: money.sunCzk
    });
  }
  return days;
}
