/*
This test suite verifies forecast.solar payload parsing for flat and nested formats.
It ensures day totals are extracted from the response shape used by the live API.
*/

import { describe, expect, it, vi } from "vitest";
import { createDatePair } from "../src/lib/date.js";
import { fetchPanelDailyForecast } from "../src/services/forecast-solar-client.js";

describe("fetchPanelDailyForecast", () => {
  it("parses flat date keys returned by estimate/watthours/day", async () => {
    const { todayKey, tomorrowKey } = createDatePair();
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          result: {
            [todayKey]: 10000,
            [tomorrowKey]: 12000
          }
        }),
        { status: 200 }
      )
    );

    const forecast = await fetchPanelDailyForecast(
      {
        lat: 50.6920036,
        lon: 15.2203556,
        slope: 45,
        azimuth: -63,
        kwp: 5.5
      },
      {
        forecastSolarApiKey: "",
        timeoutMs: 8000,
        fetchImpl
      }
    );

    expect(forecast.todayWh).toBe(10000);
    expect(forecast.tomorrowWh).toBe(12000);
  });

  it("keeps one forecast for the cache lifetime and serves it when forecast.solar is rate limited", async () => {
    const { todayKey, tomorrowKey } = createDatePair();
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls > 1)
        return new Response("", { status: 429 });
      return new Response(
        JSON.stringify({ result: { [todayKey]: 1000, [tomorrowKey]: 2000 } }),
        { status: 200 }
      );
    });
    const query = { lat: 1, lon: 2, slope: 3, azimuth: 4, kwp: 5 };
    const deps = {
      forecastSolarApiKey: "",
      timeoutMs: 8000,
      fetchImpl,
      cacheTtlSeconds: 3600,
      forecastCache: new Map()
    };

    const first = await fetchPanelDailyForecast(query, deps);
    const second = await fetchPanelDailyForecast(query, deps);
    const limited = await fetchPanelDailyForecast(query, { ...deps, cacheTtlSeconds: 0 });

    expect(first).toEqual({ todayWh: 1000, tomorrowWh: 2000 });
    expect(second).toEqual(first);
    expect(limited).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
