/*
This module aggregates east and west panel forecasts into total daily kWh.
It isolates conversion and sum logic from route handlers.
*/

import {
  fetchPanelDailyForecast,
  type ForecastClientDeps,
  type PanelQuery
} from "./forecast-solar-client.js";

export type PvPredictionQuery = {
  lat: number;
  lon: number;
  slope: number;
  eastAzimuth: number;
  eastKwp: number;
  westAzimuth: number;
  westKwp: number;
};

export type AggregatedPrediction = {
  todayKwh: number;
  tomorrowKwh: number;
};

/* Convert watt-hours into kilowatt-hours. */
function toKwh(valueWh: number): number {
  return valueWh / 1000;
}

/* Create one panel query object from shared and orientation-specific values. */
function createPanelQuery(
  source: PvPredictionQuery,
  azimuth: number,
  kwp: number
): PanelQuery {
  return {
    lat: source.lat,
    lon: source.lon,
    slope: source.slope,
    azimuth,
    kwp
  };
}

/* Fetch both orientations and aggregate today/tomorrow totals in kWh. */
export async function aggregatePvPrediction(
  query: PvPredictionQuery,
  deps: ForecastClientDeps
): Promise<AggregatedPrediction> {
  const eastQuery = createPanelQuery(query, query.eastAzimuth, query.eastKwp);
  const westQuery = createPanelQuery(query, query.westAzimuth, query.westKwp);

  const [east, west] = await Promise.all([
    fetchPanelDailyForecast(eastQuery, deps),
    fetchPanelDailyForecast(westQuery, deps)
  ]);

  return {
    todayKwh: toKwh(east.todayWh + west.todayWh),
    tomorrowKwh: toKwh(east.tomorrowWh + west.tomorrowWh)
  };
}
