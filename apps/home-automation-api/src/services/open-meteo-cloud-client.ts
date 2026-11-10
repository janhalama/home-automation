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

/* Morning low cloud for each day in a span. The archive covers the month. The forecast fills the last two days. */
export async function fetchMorningLowCloudSpan(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string,
  fetchImpl: FetchImpl
): Promise<Map<string, number>> {
  const clouds = new Map<string, number>();
  await collectMornings(clouds, [
    "https://archive-api.open-meteo.com/v1/archive",
    `?latitude=${lat}`,
    `&longitude=${lon}`,
    `&start_date=${startDate}`,
    `&end_date=${endDate}`,
    "&hourly=cloud_cover_low",
    "&timezone=Europe%2FPrague"
  ].join(""), fetchImpl);
  await collectMornings(clouds, [
    "https://api.open-meteo.com/v1/forecast",
    `?latitude=${lat}`,
    `&longitude=${lon}`,
    "&hourly=cloud_cover_low",
    "&timezone=Europe%2FPrague",
    "&past_days=2",
    "&forecast_days=3",
    "&models=icon_d2"
  ].join(""), fetchImpl);
  return clouds;
}

/* Group one hourly cloud payload into morning means. A short morning is left out. */
async function collectMornings(clouds: Map<string, number>, url: string, fetchImpl: FetchImpl): Promise<void> {
  try {
    const response = await fetchImpl(url);
    if (!response.ok)
      return;
    const payload = await response.json() as {
      hourly?: { time?: string[]; cloud_cover_low?: Array<number | null> };
    };
    const times = payload.hourly?.time ?? [];
    const values = payload.hourly?.cloud_cover_low ?? [];
    const grouped = new Map<string, number[]>();
    times.forEach((time, index) => {
      const hour = time.slice(11, 13);
      const value = values[index];
      if (hour < "06" || hour > "11" || value === null || value === undefined)
        return;
      const date = time.slice(0, 10);
      const bucket = grouped.get(date) ?? [];
      bucket.push(value);
      grouped.set(date, bucket);
    });
    for (const [date, morning] of grouped) {
      if (morning.length >= 4)
        clouds.set(date, morning.reduce((sum, value) => sum + value, 0) / morning.length);
    }
  } catch {
    return;
  }
}
