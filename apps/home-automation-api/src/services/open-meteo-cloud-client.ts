/*
Reads tomorrow morning's low-cloud forecast from Open-Meteo.
Low cloud is the layer up to about 2 km, including fog in the valley.
The mean uses 06:00 through 11:00 in Europe/Prague.
*/

import type { FetchImpl } from "./forecast-solar-client.js";

/* Average the forecast low-cloud percentage for tomorrow morning. */
export async function fetchTomorrowMorningLowCloud(
  lat: number,
  lon: number,
  tomorrowKey: string,
  fetchImpl: FetchImpl
): Promise<number | null> {
  const url = [
    "https://api.open-meteo.com/v1/forecast",
    `?latitude=${lat}`,
    `&longitude=${lon}`,
    "&hourly=cloud_cover_low",
    "&timezone=Europe%2FPrague",
    "&forecast_days=3",
    "&models=icon_d2"
  ].join("");

  const response = await fetchImpl(url);
  if (!response.ok)
    return null;

  const payload = await response.json() as {
    hourly?: { time?: string[]; cloud_cover_low?: Array<number | null> };
  };
  const times = payload.hourly?.time ?? [];
  const values = payload.hourly?.cloud_cover_low ?? [];
  const morning = times.flatMap((time, index) => {
    const hour = time.slice(11, 13);
    const value = values[index];
    if (!time.startsWith(tomorrowKey) || hour < "06" || hour > "11" || value === null || value === undefined)
      return [];
    return [value];
  });

  if (morning.length < 4)
    return null;
  return morning.reduce((sum, value) => sum + value, 0) / morning.length;
}

/* Average low cloud from 06:00 through 11:00 on one Prague day. */
async function morningMean(url: string, dateKey: string, fetchImpl: FetchImpl): Promise<number | null> {
  try {
    const response = await fetchImpl(url);
    if (!response.ok)
      return null;
    const payload = await response.json() as {
      hourly?: { time?: string[]; cloud_cover_low?: Array<number | null> };
    };
    const times = payload.hourly?.time ?? [];
    const values = payload.hourly?.cloud_cover_low ?? [];
    const morning = times.flatMap((time, index) => {
      const hour = time.slice(11, 13);
      const value = values[index];
      if (!time.startsWith(dateKey) || hour < "06" || hour > "11" || value === null || value === undefined)
        return [];
      return [value];
    });
    if (morning.length < 4)
      return null;
    return morning.reduce((sum, value) => sum + value, 0) / morning.length;
  } catch {
    return null;
  }
}

/* Read one morning's low cloud. A recent day comes from the forecast. An older day comes from the archive. */
export async function fetchMorningLowCloud(
  lat: number,
  lon: number,
  dateKey: string,
  fetchImpl: FetchImpl
): Promise<number | null> {
  const fromForecast = await morningMean(
    [
      "https://api.open-meteo.com/v1/forecast",
      `?latitude=${lat}`,
      `&longitude=${lon}`,
      "&hourly=cloud_cover_low",
      "&timezone=Europe%2FPrague",
      "&past_days=2",
      "&forecast_days=3",
      "&models=icon_d2"
    ].join(""),
    dateKey,
    fetchImpl
  );
  if (fromForecast !== null)
    return fromForecast;
  return morningMean(
    [
      "https://archive-api.open-meteo.com/v1/archive",
      `?latitude=${lat}`,
      `&longitude=${lon}`,
      `&start_date=${dateKey}`,
      `&end_date=${dateKey}`,
      "&hourly=cloud_cover_low",
      "&timezone=Europe%2FPrague"
    ].join(""),
    dateKey,
    fetchImpl
  );
}
