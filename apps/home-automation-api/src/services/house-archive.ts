/*
Stores OTE prices and tank heating periods in the API's SQLite file.
The tracker on the Miniserver keeps only ten entries, and a live read returned none, so a period is opened from the heater output.
*/

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { SpotPrice } from "./ote-day-ahead.js";

export type HeatingSample = {
  at: string;
  heatingOn: boolean;
  temperatureC: number;
};

export type HeatingPeriod = {
  startedAt: string;
  endedAt: string | null;
  startTemperatureC: number;
  endTemperatureC: number | null;
};

export type PowerReading = {
  at: string;
  pvKw: number;
  meterKw: number;
  batteryKw: number;
  socPercent: number;
};

export type HouseArchive = {
  saveSpotPrices(prices: SpotPrice[]): void;
  listSpotPrices(date: string): SpotPrice[];
  savePowerSample(sample: PowerReading): void;
  listPowerSamples(date: string): PowerReading[];
  latestPowerSampleBefore(date: string): PowerReading | null;
  applyHeatingSample(sample: HeatingSample): void;
  listHeatingPeriods(date: string): HeatingPeriod[];
  hasHeatingHistory(): boolean;
  latestHeating(): HeatingSample | null;
  close(): void;
};

/* Open a period when the heater turns on, and close it when the heater turns off. */
export function heatingTransition(
  open: HeatingPeriod | null,
  sample: HeatingSample
): { open: HeatingPeriod | null; closed: HeatingPeriod | null } {
  if (sample.heatingOn && !open)
    return {
      open: {
        startedAt: sample.at,
        endedAt: null,
        startTemperatureC: sample.temperatureC,
        endTemperatureC: null
      },
      closed: null
    };
  if (!sample.heatingOn && open)
    return {
      open: null,
      closed: {
        ...open,
        endedAt: sample.at,
        endTemperatureC: sample.temperatureC
      }
    };
  return { open, closed: null };
}

type PowerRow = {
  at: string;
  pv_kw: number;
  meter_kw: number;
  battery_kw: number;
  soc_percent: number;
};

/* Map stored power rows onto the reading the rest of the API uses. */
function readPowerRows(rows: PowerRow[]): PowerReading[] {
  return rows.map((row) => ({
    at: row.at,
    pvKw: row.pv_kw,
    meterKw: row.meter_kw,
    batteryKw: row.battery_kw,
    socPercent: row.soc_percent
  }));
}

/* Open the house archive and create its tables when they are missing. */
export function openHouseArchive(path: string): HouseArchive {
  if (path !== ":memory:")
    mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  if (path !== ":memory:")
    database.exec("PRAGMA journal_mode = WAL");
  database.exec(`
    CREATE TABLE IF NOT EXISTS spot_prices (
      date TEXT NOT NULL,
      period_index INTEGER NOT NULL,
      period_interval TEXT NOT NULL,
      eur_per_mwh REAL NOT NULL,
      PRIMARY KEY (date, period_index)
    );
    CREATE TABLE IF NOT EXISTS heating_periods (
      started_at TEXT PRIMARY KEY,
      ended_at TEXT,
      start_temperature_c REAL NOT NULL,
      end_temperature_c REAL
    );
    CREATE TABLE IF NOT EXISTS power_samples (
      at TEXT PRIMARY KEY,
      pv_kw REAL NOT NULL,
      meter_kw REAL NOT NULL,
      battery_kw REAL NOT NULL,
      soc_percent REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS heating_latest (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      at TEXT NOT NULL,
      heating_on INTEGER NOT NULL,
      temperature_c REAL NOT NULL
    );
  `);

  const savePrice = database.prepare(`
    INSERT INTO spot_prices (date, period_index, period_interval, eur_per_mwh)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(date, period_index) DO UPDATE SET
      period_interval = excluded.period_interval,
      eur_per_mwh = excluded.eur_per_mwh
  `);
  const listPrices = database.prepare(`
    SELECT date, period_index, period_interval, eur_per_mwh
    FROM spot_prices
    WHERE date = ?
    ORDER BY period_index
  `);
  const findOpen = database.prepare(`
    SELECT started_at, start_temperature_c
    FROM heating_periods
    WHERE ended_at IS NULL
  `);
  const insertPeriod = database.prepare(`
    INSERT INTO heating_periods (started_at, ended_at, start_temperature_c, end_temperature_c)
    VALUES (?, NULL, ?, NULL)
  `);
  const closePeriod = database.prepare(`
    UPDATE heating_periods
    SET ended_at = ?, end_temperature_c = ?
    WHERE started_at = ?
  `);
  const listPeriods = database.prepare(`
    SELECT started_at, ended_at, start_temperature_c, end_temperature_c
    FROM heating_periods
    WHERE started_at LIKE ? OR ended_at LIKE ?
    ORDER BY started_at
  `);
  const countPeriods = database.prepare(`SELECT COUNT(*) AS count FROM heating_periods`);
  const saveLatest = database.prepare(`
    INSERT INTO heating_latest (id, at, heating_on, temperature_c)
    VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      at = excluded.at,
      heating_on = excluded.heating_on,
      temperature_c = excluded.temperature_c
  `);
  const readLatest = database.prepare(`
    SELECT at, heating_on, temperature_c FROM heating_latest WHERE id = 1
  `);
  const savePower = database.prepare(`
    INSERT INTO power_samples (at, pv_kw, meter_kw, battery_kw, soc_percent)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(at) DO UPDATE SET
      pv_kw = excluded.pv_kw,
      meter_kw = excluded.meter_kw,
      battery_kw = excluded.battery_kw,
      soc_percent = excluded.soc_percent
  `);
  const listPower = database.prepare(`
    SELECT at, pv_kw, meter_kw, battery_kw, soc_percent
    FROM power_samples
    WHERE at LIKE ?
    ORDER BY at
  `);
  const latestPowerBefore = database.prepare(`
    SELECT at, pv_kw, meter_kw, battery_kw, soc_percent
    FROM power_samples
    WHERE at < ?
    ORDER BY at DESC
    LIMIT 1
  `);

  return {
    saveSpotPrices(prices) {
      for (const price of prices)
        savePrice.run(price.date, price.periodIndex, price.periodInterval, price.eurPerMwh);
    },
    savePowerSample(sample) {
      savePower.run(sample.at, sample.pvKw, sample.meterKw, sample.batteryKw, sample.socPercent);
    },
    listPowerSamples(date) {
      return readPowerRows(listPower.all(`${date}%`) as PowerRow[]);
    },
    latestPowerSampleBefore(date) {
      const row = latestPowerBefore.get(date) as PowerRow | undefined;
      return row ? readPowerRows([row])[0] : null;
    },
    listSpotPrices(date) {
      const rows = listPrices.all(date) as Array<{
        date: string;
        period_index: number;
        period_interval: string;
        eur_per_mwh: number;
      }>;
      return rows.map((row) => ({
        date: row.date,
        periodIndex: row.period_index,
        periodInterval: row.period_interval,
        eurPerMwh: row.eur_per_mwh
      }));
    },
    applyHeatingSample(sample) {
      const row = findOpen.get() as { started_at: string; start_temperature_c: number } | undefined;
      const open = row
        ? {
            startedAt: row.started_at,
            endedAt: null,
            startTemperatureC: row.start_temperature_c,
            endTemperatureC: null
          }
        : null;
      const next = heatingTransition(open, sample);
      if (next.closed)
        closePeriod.run(next.closed.endedAt, next.closed.endTemperatureC, next.closed.startedAt);
      if (next.open && !open)
        insertPeriod.run(next.open.startedAt, next.open.startTemperatureC);
      saveLatest.run(sample.at, sample.heatingOn ? 1 : 0, sample.temperatureC);
    },
    listHeatingPeriods(date) {
      const rows = listPeriods.all(`${date}%`, `${date}%`) as Array<{
        started_at: string;
        ended_at: string | null;
        start_temperature_c: number;
        end_temperature_c: number | null;
      }>;
      return rows.map((row) => ({
        startedAt: row.started_at,
        endedAt: row.ended_at,
        startTemperatureC: row.start_temperature_c,
        endTemperatureC: row.end_temperature_c
      }));
    },
    hasHeatingHistory() {
      const row = countPeriods.get() as { count: number };
      return row.count > 0;
    },
    latestHeating() {
      const row = readLatest.get() as
        | { at: string; heating_on: number; temperature_c: number }
        | undefined;
      if (!row)
        return null;
      return {
        at: row.at,
        heatingOn: row.heating_on === 1,
        temperatureC: row.temperature_c
      };
    },
    close() {
      database.close();
    }
  };
}
