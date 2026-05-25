/*
This module contains a focused forecast.solar HTTP client.
It builds endpoint URLs, handles upstream failures, and extracts day totals.
*/

import { createDatePair } from "../lib/date.js";

export type PanelQuery = {
  lat: number;
  lon: number;
  slope: number;
  azimuth: number;
  kwp: number;
};

export type DailyForecast = {
  todayWh: number;
  tomorrowWh: number;
};

export type HttpResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

export type FetchImpl = (
  url: string,
  init?: { signal?: AbortSignal }
) => Promise<HttpResponse>;

export type ForecastClientDeps = {
  forecastSolarApiKey: string;
  timeoutMs: number;
  fetchImpl: FetchImpl;
};

export type ForecastClientErrorCode =
  | "timeout"
  | "upstream_unavailable"
  | "upstream_unauthorized"
  | "upstream_rate_limited"
  | "upstream_invalid_payload";

export type ForecastClientError = {
  kind: "forecast_client_error";
  code: ForecastClientErrorCode;
};

/* Build a typed client error object. */
function createForecastClientError(code: ForecastClientErrorCode): ForecastClientError {
  return { kind: "forecast_client_error", code };
}

/* Narrow unknown errors to typed client errors. */
export function isForecastClientError(value: unknown): value is ForecastClientError {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    (value as { kind?: string }).kind === "forecast_client_error" &&
    "code" in value
  );
}

/* Build a forecast.solar daily estimate URL for one panel orientation. */
function buildForecastUrl(query: PanelQuery, apiKey: string): string {
  const keyPrefix = apiKey ? `/${apiKey}` : "";
  return `https://api.forecast.solar${keyPrefix}/estimate/watthours/day/${query.lat}/${query.lon}/${query.slope}/${query.azimuth}/${query.kwp}`;
}

/* Extract date-keyed day totals from forecast.solar response variants. */
function extractDayMap(payload: unknown): Record<string, unknown> | undefined {
  const result = (payload as { result?: Record<string, unknown> })?.result;
  if (!result)
    return undefined;

  const nestedDayMap = result.watt_hours_day;
  if (nestedDayMap && typeof nestedDayMap === "object" && !Array.isArray(nestedDayMap))
    return nestedDayMap as Record<string, unknown>;

  const flatDayMap = Object.fromEntries(
    Object.entries(result).filter(([key]) => /^\d{4}-\d{2}-\d{2}$/.test(key))
  );

  if (Object.keys(flatDayMap).length > 0)
    return flatDayMap;

  return undefined;
}

/* Parse and validate required daily values from forecast.solar payload. */
function parseDailyForecastPayload(payload: unknown): DailyForecast {
  const datePair = createDatePair();
  const dayMap = extractDayMap(payload);
  const todayRaw = dayMap?.[datePair.todayKey];
  const tomorrowRaw = dayMap?.[datePair.tomorrowKey];

  if (typeof todayRaw !== "number" || typeof tomorrowRaw !== "number")
    throw createForecastClientError("upstream_invalid_payload");

  return {
    todayWh: todayRaw,
    tomorrowWh: tomorrowRaw
  };
}

/* Fetch daily predictions for one panel orientation with timeout and mapping. */
export async function fetchPanelDailyForecast(
  query: PanelQuery,
  deps: ForecastClientDeps
): Promise<DailyForecast> {
  const url = buildForecastUrl(query, deps.forecastSolarApiKey);

  try {
    const response = await deps.fetchImpl(url, {
      signal: AbortSignal.timeout(deps.timeoutMs)
    });

    if (!response.ok) {
      if (response.status === 503)
        throw createForecastClientError("upstream_unavailable");
      if (response.status === 429)
        throw createForecastClientError("upstream_rate_limited");
      if (response.status === 401 || response.status === 403)
        throw createForecastClientError("upstream_unauthorized");
      throw createForecastClientError("upstream_invalid_payload");
    }

    const json = await response.json();
    return parseDailyForecastPayload(json);
  } catch (error) {
    if (isForecastClientError(error))
      throw error;
    if (error instanceof Error && error.name === "TimeoutError")
      throw createForecastClientError("timeout");
    throw createForecastClientError("upstream_invalid_payload");
  }
}
