/*
The next climb of more than 2 Kč/kWh above the cheap stretch still ahead.
The list is already in time order. A rise that has ended is omitted by the caller.
*/

import { czkPerKwh } from "./ote-day-ahead.js";

const GAP_CZK = 2;
const CZK_PER_EUR = 25;

export type RiseQuarter = {
  periodInterval: string;
  eurPerMwh: number;
};

export type PriceRise = {
  from: string;
  to: string | null;
};

/* Kč/kWh at the rate that matches Loxone. 100 EUR/MWh is 2.5 Kč/kWh. */
function priceCzk(eurPerMwh: number): number {
  return czkPerKwh(eurPerMwh, CZK_PER_EUR);
}

/* Clock at the start of an OTE interval. */
function startClock(periodInterval: string): string {
  return periodInterval.split("-")[0];
}

/* First climb of more than 2 Kč above the trough still ahead. to is where it falls back, or null when the list ends inside the rise. */
export function nextPriceRise(quarters: RiseQuarter[]): PriceRise | null {
  let cursor = 0;
  while (cursor < quarters.length) {
    let trough = quarters[cursor].eurPerMwh;
    while (cursor < quarters.length && priceCzk(quarters[cursor].eurPerMwh) - priceCzk(trough) <= GAP_CZK) {
      trough = Math.min(trough, quarters[cursor].eurPerMwh);
      cursor += 1;
    }
    if (cursor >= quarters.length)
      return null;
    const from = startClock(quarters[cursor].periodInterval);
    while (cursor < quarters.length && priceCzk(quarters[cursor].eurPerMwh) - priceCzk(trough) > GAP_CZK)
      cursor += 1;
    return {
      from,
      to: cursor < quarters.length ? startClock(quarters[cursor].periodInterval) : null
    };
  }
  return null;
}
