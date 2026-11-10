/*
Hourly panel power from forecast.solar, kept so the plan can see
when that power meets the house.
East and west are added. A fresh store is reused for three hours.
*/

import type { FetchImpl } from "./forecast-solar-client.js";
import type { PredictionStore, SunHour } from "./prediction-store.js";

const PANELS = {
  lat: 50.6920036,
  lon: 15.2203556,
  slope: 45,
  eastAzimuth: -63,
  eastKwp: 5.5,
  westAzimuth: 113,
  westKwp: 4.5
};

const FRESH_MS = 3 * 60 * 60 * 1000;

export type SunFetch = {
  store: PredictionStore;
  fetchImpl: FetchImpl;
  apiKey: string;
  timeoutMs: number;
  now: Date;
};

/* Watts at each timestamp. An unexpected payload has none. */
export function wattsFromPayload(payload: unknown): Map<string, number> {
  const watts = (payload as { result?: { watts?: unknown } }).result?.watts;
  const hours = new Map<string, number>();
  if (!watts || typeof watts !== "object" || Array.isArray(watts))
    return hours;
  for (const [stamp, value] of Object.entries(watts)) {
    if (typeof value !== "number")
      continue;
    const at = (stamp.includes("T") ? stamp : stamp.replace(" ", "T")).slice(0, 19);
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(at))
      hours.set(at, value);
  }
  return hours;
}

/* One forecast.solar estimate URL for a panel. */
function estimateUrl(azimuth: number, kwp: number, apiKey: string): string {
  const key = apiKey ? `/${apiKey}` : "";
  return `https://api.forecast.solar${key}/estimate/${PANELS.lat}/${PANELS.lon}/${PANELS.slope}/${azimuth}/${kwp}`;
}

/* Add the watts of both roofs. */
function combined(east: Map<string, number>, west: Map<string, number>): SunHour[] {
  const times = new Set([...east.keys(), ...west.keys()]);
  return [...times].sort().map((at) => ({
    at,
    pvKw: ((east.get(at) ?? 0) + (west.get(at) ?? 0)) / 1000
  }));
}

/* Read one estimate. A bad response contributes no hours. */
async function readWatts(url: string, fetchImpl: FetchImpl, timeoutMs: number): Promise<Map<string, number>> {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok)
    return new Map();
  return wattsFromPayload(await response.json());
}

/* Store today and tomorrow when the last issue is older than three hours. */
export async function rememberSunHours(input: SunFetch): Promise<void> {
  const issued = input.store.latestSunIssuedAt();
  if (issued && input.now.getTime() - Date.parse(issued) < FRESH_MS)
    return;
  const [east, west] = await Promise.all([
    readWatts(estimateUrl(PANELS.eastAzimuth, PANELS.eastKwp, input.apiKey), input.fetchImpl, input.timeoutMs),
    readWatts(estimateUrl(PANELS.westAzimuth, PANELS.westKwp, input.apiKey), input.fetchImpl, input.timeoutMs)
  ]);
  const hours = combined(east, west);
  if (hours.length === 0)
    return;
  input.store.saveSunHours(hours, input.now.toISOString());
}
