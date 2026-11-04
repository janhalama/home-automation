/*
Scores one day: whether imports were cheap, exports were expensive, the battery stayed above 20%, and morning PV was exported when the sun already covered the night.
Meter power is negative when the house imports. Battery power is negative when the battery charges.
*/

import { cloudBand, expectedPvKwh, overnightKwh, type Season } from "./seasonal-profile.js";
import type { SpotPrice } from "./ote-day-ahead.js";
import type { HeatingPeriod } from "./house-archive.js";

export type PowerSample = {
  time: string;
  meterKw: number;
  batteryKw: number;
  pvKw: number;
  socPercent: number;
};

export type DayScore = {
  medianEurPerMwh: number;
  importWeightedEurPerMwh: number | null;
  exportWeightedEurPerMwh: number | null;
  boughtCheaply: boolean | null;
  soldExpensively: boolean | null;
  minutesBelowFloor: number;
  lowestSocPercent: number;
  exportWasWise: boolean;
  tankPeriodsOnCheapHalf: number | null;
};

const FLOOR_PERCENT = 20;
const MORNING_START = 6 * 60;
const MORNING_END = 12 * 60;

/* Clock HH:MM or HH:MM:SS to minutes after midnight. */
function minutes(clock: string): number {
  const [hour, minute] = clock.split(":");
  return Number(hour) * 60 + Number(minute);
}

/* Middle price. An even count uses the mean of the two middle prices. */
function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1)
    return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

/* Find the OTE interval that contains this clock time. */
function priceAt(prices: SpotPrice[], clock: string): number {
  const at = minutes(clock);
  const match = prices.find((price) => {
    const [start, end] = price.periodInterval.split("-");
    const startMinutes = minutes(start);
    let endMinutes = minutes(end);
    if (endMinutes <= startMinutes)
      endMinutes += 24 * 60;
    return at >= startMinutes && at < endMinutes;
  });
  if (!match)
    throw new Error(`No OTE price for ${clock}`);
  return match.eurPerMwh;
}

/* True when a heating period overlaps a cheap interval of this date. */
function overlapsCheapHalf(
  period: HeatingPeriod,
  date: string,
  prices: SpotPrice[],
  medianPrice: number
): boolean {
  if (!period.startedAt.startsWith(date))
    return false;
  const start = minutes(period.startedAt.slice(11, 16));
  const end = period.endedAt && period.endedAt.startsWith(date)
    ? minutes(period.endedAt.slice(11, 16))
    : 24 * 60;
  return prices.some((price) => {
    if (price.eurPerMwh > medianPrice)
      return false;
    const [from, to] = price.periodInterval.split("-");
    const fromMinutes = minutes(from);
    let toMinutes = minutes(to);
    if (toMinutes <= fromMinutes)
      toMinutes += 24 * 60;
    return start < toMinutes && end > fromMinutes;
  });
}

/* Score the house for one delivery day. */
export function scoreDay(input: {
  date: string;
  season: Season;
  lowCloudPercent: number;
  prices: SpotPrice[];
  samples: PowerSample[];
  tankPeriods: HeatingPeriod[] | null;
}): DayScore {
  if (input.prices.length === 0)
    throw new Error("The price for this day is missing");
  if (input.samples.length === 0)
    throw new Error("The day curve is missing");

  const medianPrice = median(input.prices.map((price) => price.eurPerMwh));
  let importKwh = 0;
  let importCost = 0;
  let exportKwh = 0;
  let exportCost = 0;
  let morningExportKwh = 0;
  let morningChargeKwh = 0;
  let minutesBelowFloor = 0;
  let lowestSocPercent = input.samples[0].socPercent;

  for (let index = 0; index < input.samples.length - 1; index += 1) {
    const left = input.samples[index];
    const right = input.samples[index + 1];
    const span = (minutes(right.time) - minutes(left.time)) / 60;
    if (span <= 0)
      continue;
    const meterKw = left.meterKw;
    const batteryKw = left.batteryKw;
    const at = minutes(left.time);
    if (meterKw < 0) {
      const kwh = -meterKw * span;
      const price = priceAt(input.prices, left.time);
      importKwh += kwh;
      importCost += kwh * price;
    }
    if (meterKw > 0) {
      const kwh = meterKw * span;
      const price = priceAt(input.prices, left.time);
      exportKwh += kwh;
      exportCost += kwh * price;
    }
    if (at >= MORNING_START && at < MORNING_END) {
      if (meterKw > 0)
        morningExportKwh += meterKw * span;
      if (batteryKw < 0)
        morningChargeKwh += -batteryKw * span;
    }
    if (left.socPercent < FLOOR_PERCENT)
      minutesBelowFloor += span * 60;
    lowestSocPercent = Math.min(lowestSocPercent, left.socPercent, right.socPercent);
  }

  const expected = expectedPvKwh(input.season, cloudBand(input.lowCloudPercent));
  const overnight = overnightKwh(input.season);
  const exportWasWise = expected >= overnight
    ? morningExportKwh >= morningChargeKwh
    : morningChargeKwh >= morningExportKwh;

  return {
    medianEurPerMwh: medianPrice,
    importWeightedEurPerMwh: importKwh > 0 ? importCost / importKwh : null,
    exportWeightedEurPerMwh: exportKwh > 0 ? exportCost / exportKwh : null,
    boughtCheaply: importKwh > 0 ? importCost / importKwh < medianPrice : null,
    soldExpensively: exportKwh > 0 ? exportCost / exportKwh > medianPrice : null,
    minutesBelowFloor,
    lowestSocPercent,
    exportWasWise,
    tankPeriodsOnCheapHalf: input.tankPeriods === null
      ? null
      : input.tankPeriods.filter((period) =>
          overlapsCheapHalf(period, input.date, input.prices, medianPrice)
        ).length
  };
}
