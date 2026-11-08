/*
Aligns one day's price, heater, and power samples onto a single timeline.
The axis is the whole price day. Measurements stay empty where none were stored yet,
so a plan can be drawn through the evening on a day that is still in progress.
*/

import type { HeatingPeriod } from "./house-archive.js";
import type { PowerSample } from "./day-score.js";
import type { SpotPrice } from "./ote-day-ahead.js";

export type EnergyPoint = {
  time: string;
  priceEurPerMwh: number | null;
  pvKw: number | null;
  meterKw: number | null;
  batteryKw: number | null;
  socPercent: number | null;
  heatingOn: boolean | null;
  tankTemperatureC: number | null;
};

/* Clock HH:MM or HH:MM:SS to minutes after midnight. */
function minutes(clock: string): number {
  const [hour, minute] = clock.split(":");
  return Number(hour) * 60 + Number(minute);
}

/* Price of the 15-minute interval that contains this clock, if one was stored. */
function priceAt(prices: SpotPrice[], clock: string): number | null {
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

/* True when a stored heating period covers this clock time. */
function heatingOnAt(periods: HeatingPeriod[], date: string, clock: string): boolean {
  const at = `${date}T${clock.slice(0, 8)}`;
  return periods.some((period) => period.startedAt <= at && (period.endedAt === null || period.endedAt > at));
}

/* Seconds after midnight. Missing seconds count as zero. */
function clockSeconds(clock: string): number {
  const [hour, minute, second] = clock.split(":");
  return Number(hour) * 3600 + Number(minute) * 60 + Number(second ?? 0);
}

/* The 15-minute slot a clock belongs to. */
function quarterIndex(clock: string): number {
  return Math.floor(clockSeconds(clock) / 900);
}

/* The latest stored tank temperature in the same quarter, if one exists. */
function temperatureAt(clock: string, temperatures: { time: string; temperatureC: number }[]): number | null {
  const slot = quarterIndex(clock);
  let best: { at: number; temperatureC: number } | null = null;
  for (const reading of temperatures) {
    if (quarterIndex(reading.time) !== slot)
      continue;
    const at = clockSeconds(reading.time);
    if (!best || at >= best.at)
      best = { at, temperatureC: reading.temperatureC };
  }
  return best ? best.temperatureC : null;
}

/* HH:MM:SS from a price interval. */
function quarterClock(periodInterval: string): string {
  return `${periodInterval.slice(0, 5)}:00`;
}

/* Clock times for the tank temperature: each stored reading, and the ends of older heater runs. */
export function tankTemperatureClocks(
  samples: { at: string; temperatureC: number }[],
  periods: HeatingPeriod[],
  date: string
): { time: string; temperatureC: number }[] {
  const ends = periods.flatMap((period) => {
    const points: { time: string; temperatureC: number }[] = [];
    if (period.startedAt.startsWith(date))
      points.push({ time: period.startedAt.slice(11), temperatureC: period.startTemperatureC });
    if (period.endedAt?.startsWith(date) && period.endTemperatureC !== null)
      points.push({ time: period.endedAt.slice(11), temperatureC: period.endTemperatureC });
    return points;
  });
  const readings = samples
    .filter((sample) => sample.at.startsWith(date))
    .map((sample) => ({ time: sample.at.slice(11), temperatureC: sample.temperatureC }));
  return [...ends, ...readings];
}
export function alignEnergyDay(input: {
  date: string;
  prices: SpotPrice[];
  samples: PowerSample[];
  heating: HeatingPeriod[];
  temperatures?: { time: string; temperatureC: number }[];
}): EnergyPoint[] {
  const temperatures = input.temperatures ?? [];
  const measured = input.samples.map((sample) => ({
    time: sample.time,
    priceEurPerMwh: priceAt(input.prices, sample.time),
    pvKw: sample.pvKw,
    meterKw: sample.meterKw,
    batteryKw: sample.batteryKw,
    socPercent: sample.socPercent,
    heatingOn: heatingOnAt(input.heating, input.date, sample.time),
    tankTemperatureC: temperatureAt(sample.time, temperatures)
  }));
  if (input.prices.length === 0)
    return measured;

  const covered = new Set(input.samples.map((sample) => quarterIndex(sample.time)));
  const lastSampleSeconds = input.samples.reduce(
    (last, sample) => Math.max(last, clockSeconds(sample.time)),
    -1
  );
  const remaining = input.prices.flatMap((price) => {
    const time = quarterClock(price.periodInterval);
    if (covered.has(quarterIndex(time)))
      return [];
    const stillAhead = clockSeconds(time) > lastSampleSeconds;
    return [{
      time,
      priceEurPerMwh: price.eurPerMwh,
      pvKw: null,
      meterKw: null,
      batteryKw: null,
      socPercent: null,
      heatingOn: stillAhead ? null : heatingOnAt(input.heating, input.date, time),
      tankTemperatureC: temperatureAt(time, temperatures)
    }];
  });

  return [...measured, ...remaining].sort((left, right) => clockSeconds(left.time) - clockSeconds(right.time));
}
