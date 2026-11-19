/*
Stores OTE prices and tank heating periods in the API's SQLite file.
The tracker on the Miniserver keeps only ten entries, and a live read returned none, so a period is opened from the heater output.
*/

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { SpotPrice } from "./ote-day-ahead.js";
import type { DecisionSegment, PlanChange, PlanInputs } from "./day-decision.js";
import { decisionStore } from "./day-decision-store.js";

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
  carChargeKw?: number | null;
  tankKw?: number | null;
  batteryChargeKw?: number | null;
};

export type HouseArchive = {
  saveSpotPrices(prices: SpotPrice[]): void;
  listSpotPrices(date: string): SpotPrice[];
  savePowerSample(sample: PowerReading): void;
  listPowerSamples(date: string): PowerReading[];
  latestPowerSampleBefore(date: string): PowerReading | null;
  applyHeatingSample(sample: HeatingSample): void;
  listHeatingPeriods(date: string): HeatingPeriod[];
  listHeatingPeriodsOverlapping(from: string, until: string): HeatingPeriod[];
  listHeatingTemperatures(date: string): { at: string; temperatureC: number }[];
  hasHeatingHistory(): boolean;
  latestHeating(): HeatingSample | null;
  listChargeWindows(date: string): StoredChargeWindow[];
  saveChargeWindows(date: string, windows: StoredChargeWindow[]): void;
  listDayDecisions(date: string): DecisionSegment[];
  saveDayDecisions(date: string, segments: DecisionSegment[]): void;
  listPlanChanges(date: string): PlanChange[];
  appendPlanChange(date: string, change: PlanChange): void;
  readPlanInputs(date: string): PlanInputs | null;
  savePlanInputs(date: string, inputs: PlanInputs): void;
  close(): void;
};

export type StoredChargeWindow = {
  from: string;
  to: string;
  kw: number;
  kwh: number;
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
  car_charge_kw: number | null;
  tank_kw: number | null;
  battery_charge_kw: number | null;
};

type HeatingPeriodRow = {
  started_at: string;
  ended_at: string | null;
  start_temperature_c: number;
  end_temperature_c: number | null;
};

/* Map stored heater rows onto the period the rest of the API uses. */
function readHeatingRows(rows: HeatingPeriodRow[]): HeatingPeriod[] {
  return rows.map((row) => ({
    startedAt: row.started_at,
    endedAt: row.ended_at,
    startTemperatureC: row.start_temperature_c,
    endTemperatureC: row.end_temperature_c
  }));
}

/* Map stored power rows onto the reading the rest of the API uses. */
function readPowerRows(rows: PowerRow[]): PowerReading[] {
  return rows.map((row) => ({
    at: row.at,
    pvKw: row.pv_kw,
    meterKw: row.meter_kw,
    batteryKw: row.battery_kw,
    socPercent: row.soc_percent,
    carChargeKw: row.car_charge_kw,
    tankKw: row.tank_kw,
    batteryChargeKw: row.battery_charge_kw
  }));
}

/* Add the tank, car, and battery-charge columns to an archive created before them. */
function ensureLoadColumns(database: DatabaseSync): void {
  const names = new Set(
    (database.prepare("PRAGMA table_info(power_samples)").all() as { name: string }[])
      .map((column) => column.name)
  );
  if (!names.has("car_charge_kw"))
    database.exec("ALTER TABLE power_samples ADD COLUMN car_charge_kw REAL");
  if (!names.has("tank_kw"))
    database.exec("ALTER TABLE power_samples ADD COLUMN tank_kw REAL");
  if (!names.has("battery_charge_kw"))
    database.exec("ALTER TABLE power_samples ADD COLUMN battery_charge_kw REAL");
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
      soc_percent REAL NOT NULL,
      car_charge_kw REAL,
      tank_kw REAL,
      battery_charge_kw REAL
    );
    CREATE TABLE IF NOT EXISTS heating_latest (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      at TEXT NOT NULL,
      heating_on INTEGER NOT NULL,
      temperature_c REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS heating_samples (
      at TEXT PRIMARY KEY,
      temperature_c REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS battery_charge_windows (
      date TEXT NOT NULL,
      from_clock TEXT NOT NULL,
      to_clock TEXT NOT NULL,
      kw REAL NOT NULL,
      kwh REAL NOT NULL,
      PRIMARY KEY (date, from_clock, to_clock)
    );
    CREATE TABLE IF NOT EXISTS day_decisions (
      date TEXT NOT NULL,
      kind TEXT NOT NULL,
      from_clock TEXT NOT NULL,
      to_clock TEXT NOT NULL,
      kw REAL NOT NULL,
      mode TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS plan_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      at TEXT NOT NULL,
      trigger TEXT NOT NULL,
      result TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS plan_change_segments (
      change_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      from_clock TEXT NOT NULL,
      to_clock TEXT NOT NULL,
      kw REAL NOT NULL,
      mode TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS plan_inputs (
      date TEXT PRIMARY KEY,
      payload TEXT NOT NULL
    );
  `);
  ensureLoadColumns(database);

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
  const listOverlappingPeriods = database.prepare(`
    SELECT started_at, ended_at, start_temperature_c, end_temperature_c
    FROM heating_periods
    WHERE started_at < ? AND (ended_at IS NULL OR ended_at > ?)
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
  const saveTemperature = database.prepare(`
    INSERT INTO heating_samples (at, temperature_c)
    VALUES (?, ?)
    ON CONFLICT(at) DO UPDATE SET temperature_c = excluded.temperature_c
  `);
  const listTemperatures = database.prepare(`
    SELECT at, temperature_c FROM heating_samples WHERE at LIKE ? ORDER BY at
  `);
  const readLatest = database.prepare(`
    SELECT at, heating_on, temperature_c FROM heating_latest WHERE id = 1
  `);
  const listChargeWindows = database.prepare(`
    SELECT from_clock, to_clock, kw, kwh
    FROM battery_charge_windows
    WHERE date = ?
    ORDER BY rowid
  `);
  const deleteChargeWindows = database.prepare(`
    DELETE FROM battery_charge_windows WHERE date = ?
  `);
  const insertChargeWindow = database.prepare(`
    INSERT INTO battery_charge_windows (date, from_clock, to_clock, kw, kwh)
    VALUES (?, ?, ?, ?, ?)
  `);
  const decisions = decisionStore(database);
  const savePower = database.prepare(`
    INSERT INTO power_samples (
      at, pv_kw, meter_kw, battery_kw, soc_percent, car_charge_kw, tank_kw, battery_charge_kw
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(at) DO UPDATE SET
      pv_kw = excluded.pv_kw,
      meter_kw = excluded.meter_kw,
      battery_kw = excluded.battery_kw,
      soc_percent = excluded.soc_percent,
      car_charge_kw = excluded.car_charge_kw,
      tank_kw = excluded.tank_kw,
      battery_charge_kw = excluded.battery_charge_kw
  `);
  const listPower = database.prepare(`
    SELECT at, pv_kw, meter_kw, battery_kw, soc_percent, car_charge_kw, tank_kw, battery_charge_kw
    FROM power_samples
    WHERE at LIKE ?
    ORDER BY at
  `);
  const latestPowerBefore = database.prepare(`
    SELECT at, pv_kw, meter_kw, battery_kw, soc_percent, car_charge_kw, tank_kw, battery_charge_kw
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
      const batteryChargeKw = sample.batteryChargeKw ?? Math.max(0, -sample.batteryKw);
      savePower.run(
        sample.at,
        sample.pvKw,
        sample.meterKw,
        sample.batteryKw,
        sample.socPercent,
        sample.carChargeKw ?? null,
        sample.tankKw ?? null,
        batteryChargeKw
      );
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
      saveTemperature.run(sample.at, sample.temperatureC);
    },
    listHeatingPeriods(date) {
      return readHeatingRows(listPeriods.all(`${date}%`, `${date}%`) as HeatingPeriodRow[]);
    },
    listHeatingPeriodsOverlapping(from, until) {
      return readHeatingRows(listOverlappingPeriods.all(until, from) as HeatingPeriodRow[]);
    },
    listHeatingTemperatures(date) {
      const rows = listTemperatures.all(`${date}%`) as Array<{ at: string; temperature_c: number }>;
      return rows.map((row) => ({ at: row.at, temperatureC: row.temperature_c }));
    },
    hasHeatingHistory() {
      const row = countPeriods.get() as { count: number };
      return row.count > 0;
    },
    listChargeWindows(date) {
      const rows = listChargeWindows.all(date) as Array<{
        from_clock: string;
        to_clock: string;
        kw: number;
        kwh: number;
      }>;
      return rows.map((row) => ({
        from: row.from_clock,
        to: row.to_clock,
        kw: row.kw,
        kwh: row.kwh
      }));
    },
    saveChargeWindows(date, windows) {
      database.exec("BEGIN");
      deleteChargeWindows.run(date);
      for (const window of windows)
        insertChargeWindow.run(date, window.from, window.to, window.kw, window.kwh);
      database.exec("COMMIT");
    },
    ...decisions,
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
