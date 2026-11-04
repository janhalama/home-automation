/*
Corrects an issued PV forecast once the same kind of day has a production record.
The kind of day is the season and the forecast low-cloud band, which is cloud below about 2 km.
*/

import { cloudBand, seasonOf } from "./seasonal-profile.js";

export type LearnedDay = {
  date: string;
  forecastKwh: number;
  lowCloud: number | null;
  actualKwh: number | null;
};

const MINIMUM_SIMILAR_DAYS = 5;

/* Return the middle production value. An even count uses the mean of the two middle values. */
function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1)
    return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

/* Signed mean of actual minus forecast, and the mean absolute deviation. */
export type ForecastDeviation = {
  count: number;
  signedMeanKwh: number;
  absoluteMeanKwh: number;
  byBand: Array<{ band: string; count: number; signedMeanKwh: number; absoluteMeanKwh: number }>;
};

export function forecastDeviation(
  days: Array<{ forecastKwh: number; actualKwh: number; lowCloud: number }>
): ForecastDeviation | null {
  if (days.length === 0)
    return null;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const signed = days.map((day) => day.actualKwh - day.forecastKwh);
  const byBand = (["clear", "mixed", "covered"] as const).flatMap((band) => {
    const group = days.filter((day) => cloudBand(day.lowCloud) === band);
    if (group.length === 0)
      return [];
    const groupSigned = group.map((day) => day.actualKwh - day.forecastKwh);
    return [{
      band,
      count: group.length,
      signedMeanKwh: mean(groupSigned),
      absoluteMeanKwh: mean(groupSigned.map((value) => Math.abs(value)))
    }];
  });
  return {
    count: days.length,
    signedMeanKwh: mean(signed),
    absoluteMeanKwh: mean(signed.map((value) => Math.abs(value))),
    byBand
  };
}

/* Use stored production when five similar forecasts already have an actual result. */
export function learnedKwh(
  forecastKwh: number,
  lowCloud: number | null,
  date: string,
  history: LearnedDay[]
): number {
  if (lowCloud === null)
    return forecastKwh;

  const season = seasonOf(date);
  const band = cloudBand(lowCloud);
  const actuals = history.flatMap((entry) => {
    if (entry.actualKwh === null || entry.lowCloud === null)
      return [];
    if (seasonOf(entry.date) !== season || cloudBand(entry.lowCloud) !== band)
      return [];
    return [entry.actualKwh];
  });

  if (actuals.length < MINIMUM_SIMILAR_DAYS)
    return forecastKwh;
  return median(actuals);
}
