/*
Read one Prague day of Obluda from TeslaMate.
Charging is wallbox power. The level is the usable state of charge.
Plugged in is the cable: from the start of a charge until the next drive.
The wallbox stopping the session does not count as unplugged.
TeslaMate stores no history of the charge limit, so this query does not ask for it.
*/

import pg from "pg";
import { buildCarDay, type CarPoint } from "./car-day.js";
import { addDays } from "./sun-clock.js";

const { Pool } = pg;

export type CarDayQuery = (text: string, values: unknown[]) => Promise<Record<string, unknown>[]>;

const CHARGE_SQL = `
  SELECT to_char(
      date_trunc('minute', (c.date AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Prague'),
      'HH24:MI:SS'
    ) AS time,
    max(c.charger_power) AS charge_kw
  FROM charges c
  JOIN charging_processes p ON p.id = c.charging_process_id
  WHERE p.car_id = 1
    AND (c.date AT TIME ZONE 'UTC') >= ($1::timestamp AT TIME ZONE 'Europe/Prague')
    AND (c.date AT TIME ZONE 'UTC') < (($1::timestamp + interval '1 day') AT TIME ZONE 'Europe/Prague')
  GROUP BY 1
`;

const LEVEL_SQL = `
  SELECT to_char(
      date_trunc('minute', (date AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Prague'),
      'HH24:MI:SS'
    ) AS time,
    (array_agg(usable_battery_level ORDER BY date DESC))[1] AS soc_percent
  FROM (
    SELECT date, usable_battery_level
    FROM positions
    WHERE car_id = 1
      AND usable_battery_level IS NOT NULL
      AND (date AT TIME ZONE 'UTC') >= ($1::timestamp AT TIME ZONE 'Europe/Prague')
      AND (date AT TIME ZONE 'UTC') < (($1::timestamp + interval '1 day') AT TIME ZONE 'Europe/Prague')
    UNION ALL
    SELECT c.date, c.usable_battery_level
    FROM charges c
    JOIN charging_processes p ON p.id = c.charging_process_id
    WHERE p.car_id = 1
      AND c.usable_battery_level IS NOT NULL
      AND (c.date AT TIME ZONE 'UTC') >= ($1::timestamp AT TIME ZONE 'Europe/Prague')
      AND (c.date AT TIME ZONE 'UTC') < (($1::timestamp + interval '1 day') AT TIME ZONE 'Europe/Prague')
  ) samples
  GROUP BY 1
`;

const PLUG_SQL = `
  SELECT EXTRACT(EPOCH FROM (
      GREATEST(cp.start_date AT TIME ZONE 'UTC', $1::timestamp AT TIME ZONE 'Europe/Prague')
      - ($1::timestamp AT TIME ZONE 'Europe/Prague')
    )) / 60 AS from_minute,
    EXTRACT(EPOCH FROM (
      LEAST(
        COALESCE(
          (
            SELECT MIN(d.start_date) AT TIME ZONE 'UTC'
            FROM drives d
            WHERE d.car_id = cp.car_id
              AND d.start_date > cp.start_date
          ),
          ($1::timestamp + interval '1 day') AT TIME ZONE 'Europe/Prague'
        ),
        ($1::timestamp + interval '1 day') AT TIME ZONE 'Europe/Prague'
      ) - ($1::timestamp AT TIME ZONE 'Europe/Prague')
    )) / 60 AS to_minute
  FROM charging_processes cp
  WHERE cp.car_id = 1
    AND (cp.start_date AT TIME ZONE 'UTC') < (($1::timestamp + interval '1 day') AT TIME ZONE 'Europe/Prague')
    AND COALESCE(
      (
        SELECT MIN(d.start_date) AT TIME ZONE 'UTC'
        FROM drives d
        WHERE d.car_id = cp.car_id
          AND d.start_date > cp.start_date
      ),
      ($1::timestamp + interval '1 day') AT TIME ZONE 'Europe/Prague'
    ) > ($1::timestamp AT TIME ZONE 'Europe/Prague')
`;

/* Open a pool when the TeslaMate database is configured. */
export function openCarDayQuery(config: {
  host: string;
  user: string;
  password: string;
  database: string;
}): { query: CarDayQuery; close: () => Promise<void> } | null {
  if (!config.host || !config.user || !config.database)
    return null;
  const pool = new Pool({
    host: config.host,
    port: 5432,
    user: config.user,
    password: config.password,
    database: config.database,
    max: 2,
    connectionTimeoutMillis: 4000
  });
  return {
    query: async (text, values) => {
      const result = await pool.query(text, values);
      return result.rows as Record<string, unknown>[];
    },
    close: () => pool.end()
  };
}

const CHARGE_SPAN_SQL = `
  SELECT to_char(
      (c.date AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Prague',
      'YYYY-MM-DD'
    ) AS day,
    to_char(
      date_trunc('minute', (c.date AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Prague'),
      'HH24:MI:SS'
    ) AS time,
    max(c.charger_power) AS charge_kw
  FROM charges c
  JOIN charging_processes p ON p.id = c.charging_process_id
  WHERE p.car_id = 1
    AND (c.date AT TIME ZONE 'UTC') >= ($1::timestamp AT TIME ZONE 'Europe/Prague')
    AND (c.date AT TIME ZONE 'UTC') < ($2::timestamp AT TIME ZONE 'Europe/Prague')
  GROUP BY 1, 2
`;

/* Quarter start, YYYY-MM-DDTHH:MM, for a Prague timestamp. */
function quarterKey(at: string): string {
  const minute = Number(at.slice(14, 16));
  const quarter = String(Math.floor(minute / 15) * 15).padStart(2, "0");
  return `${at.slice(0, 14)}${quarter}`;
}

/* Highest charge power in each quarter. */
function lookupFromRows(rows: { at: string; chargeKw: number }[]): (at: string) => number {
  const quarters = new Map<string, number>();
  for (const row of rows) {
    if (!row.chargeKw)
      continue;
    const key = quarterKey(row.at);
    quarters.set(key, Math.max(quarters.get(key) ?? 0, row.chargeKw));
  }
  return (at: string) => quarters.get(quarterKey(at)) ?? 0;
}

/* Charge power across a date span, in one query. untilDate is excluded. */
export async function chargeKwByQuarter(
  query: CarDayQuery,
  fromDate: string,
  untilDate: string
): Promise<(at: string) => number> {
  const rows = await query(CHARGE_SPAN_SQL, [fromDate, untilDate]);
  return lookupFromRows(rows.map((row) => ({
    at: `${String(row.day)}T${String(row.time)}`,
    chargeKw: Number(row.charge_kw)
  })));
}

/* One span query when the pool can do it, otherwise one full car day at a time. */
export async function chargeKwLookup(input: {
  dates: string[];
  readChargeKw: ((fromDate: string, untilDate: string) => Promise<(at: string) => number>) | null;
  readCarDay: ((date: string) => Promise<CarPoint[]>) | null;
}): Promise<(at: string) => number> {
  if (input.dates.length === 0)
    return () => 0;
  const ordered = [...input.dates].sort();
  if (input.readChargeKw)
    return input.readChargeKw(ordered[0], addDays(ordered[ordered.length - 1], 1));
  if (input.readCarDay)
    return carChargeKwAt(input.readCarDay, ordered);
  return () => 0;
}

/* Charge power for each sample time, from the quarter TeslaMate recorded. A failed day contributes nothing. */
export async function carChargeKwAt(
  read: (date: string) => Promise<CarPoint[]>,
  dates: string[]
): Promise<(at: string) => number> {
  const quarters = new Map<string, number>();
  for (const date of dates) {
    let points: CarPoint[] = [];
    try {
      points = await read(date);
    } catch {
      continue;
    }
    for (const point of points) {
      if (!point.chargeKw || !point.time)
        continue;
      quarters.set(`${date}T${point.time.slice(0, 5)}`, point.chargeKw);
    }
  }
  return (at: string) => {
    const minute = Number(at.slice(14, 16));
    const quarter = String(Math.floor(minute / 15) * 15).padStart(2, "0");
    return quarters.get(`${at.slice(0, 14)}${quarter}`) ?? 0;
  };
}

/* Load the day. The query never selects a location. */
export async function readCarDay(query: CarDayQuery, date: string): Promise<CarPoint[]> {
  const [charges, levels, plugged] = await Promise.all([
    query(CHARGE_SQL, [date]),
    query(LEVEL_SQL, [date]),
    query(PLUG_SQL, [date])
  ]);
  return buildCarDay({
    charges: charges.map((row) => ({
      time: String(row.time),
      chargeKw: Number(row.charge_kw)
    })),
    levels: levels.map((row) => ({
      time: String(row.time),
      socPercent: Number(row.soc_percent)
    })),
    limits: [],
    plugged: plugged.map((row) => ({
      fromMinute: Number(row.from_minute),
      toMinute: Number(row.to_minute)
    }))
  });
}
