/*
Applies the stored production record to the forecast the API is about to return.
Today stays the forecast.solar value. Tomorrow is corrected once five similar days exist.
*/

import { fetchTomorrowMorningLowCloud } from "./open-meteo-cloud-client.js";
import type { FetchImpl } from "./forecast-solar-client.js";
import { learnedKwh } from "./pv-forecast-learning.js";
import type { PredictionStore } from "./prediction-store.js";

export type LearnedForecast = {
  todayKwh: number;
  tomorrowKwh: number;
};

/* Format a Prague calendar day, shifted by whole days from the reference instant. */
function pragueDateKey(reference: Date, offsetDays: number): string {
  const shifted = new Date(reference.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(shifted);
}

/* Record this call and return tomorrow's kWh from similar stored days when they exist. */
export async function applyLearnedForecast(
  todayKwh: number,
  tomorrowKwh: number,
  lat: number,
  lon: number,
  yesterdayKwh: number | undefined,
  now: Date,
  fetchImpl: FetchImpl,
  store: PredictionStore
): Promise<LearnedForecast> {
  const tomorrowKey = pragueDateKey(now, 1);
  const yesterdayKey = pragueDateKey(now, -1);
  let lowCloud: number | null = null;
  try {
    lowCloud = await fetchTomorrowMorningLowCloud(lat, lon, tomorrowKey, fetchImpl);
  } catch {
    lowCloud = null;
  }

  if (yesterdayKwh !== undefined)
    store.saveActual(yesterdayKey, yesterdayKwh);

  store.saveForecast({
    date: tomorrowKey,
    forecastKwh: tomorrowKwh,
    lowCloud,
    actualKwh: null
  });

  return {
    todayKwh,
    tomorrowKwh: learnedKwh(tomorrowKwh, lowCloud, tomorrowKey, store.listCompleted())
  };
}
