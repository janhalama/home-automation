/*
Stores issued forecasts and the production that followed them.
The database is SQLite through Node's built-in driver, opened with --experimental-sqlite.
*/

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { LearnedDay } from "./pv-forecast-learning.js";

export type PredictionStore = {
  saveForecast(day: LearnedDay): void;
  saveActual(date: string, actualKwh: number): void;
  listCompleted(): LearnedDay[];
  close(): void;
};

/* Open the forecast memory and create the table when it is missing. */
export function openPredictionStore(path: string): PredictionStore {
  if (path !== ":memory:")
    mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE IF NOT EXISTS forecast_days (
      date TEXT PRIMARY KEY,
      forecast_kwh REAL NOT NULL,
      low_cloud REAL,
      actual_kwh REAL
    )
  `);

  const saveForecast = database.prepare(`
    INSERT INTO forecast_days (date, forecast_kwh, low_cloud)
    VALUES (?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      forecast_kwh = excluded.forecast_kwh,
      low_cloud = excluded.low_cloud
  `);
  const saveActual = database.prepare(`
    UPDATE forecast_days SET actual_kwh = ? WHERE date = ?
  `);
  const listCompleted = database.prepare(`
    SELECT date, forecast_kwh, low_cloud, actual_kwh
    FROM forecast_days
    WHERE actual_kwh IS NOT NULL AND low_cloud IS NOT NULL
  `);

  return {
    saveForecast(day) {
      saveForecast.run(day.date, day.forecastKwh, day.lowCloud);
    },
    saveActual(date, actualKwh) {
      saveActual.run(actualKwh, date);
    },
    listCompleted() {
      const rows = listCompleted.all() as Array<{
        date: string;
        forecast_kwh: number;
        low_cloud: number;
        actual_kwh: number;
      }>;
      return rows.map((row) => ({
        date: row.date,
        forecastKwh: row.forecast_kwh,
        lowCloud: row.low_cloud,
        actualKwh: row.actual_kwh
      }));
    },
    close() {
      database.close();
    }
  };
}
