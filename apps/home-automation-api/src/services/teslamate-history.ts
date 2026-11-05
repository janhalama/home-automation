/*
Read one Prague day of Obluda from TeslaMate.
Charging is wallbox power. The level is the usable state of charge. A charging process is the plug.
*/

import pg from "pg";
import { buildCarDay, type CarPoint } from "./car-day.js";

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
      GREATEST(start_date AT TIME ZONE 'UTC', $1::timestamp AT TIME ZONE 'Europe/Prague')
      - ($1::timestamp AT TIME ZONE 'Europe/Prague')
    )) / 60 AS from_minute,
    EXTRACT(EPOCH FROM (
      LEAST(
        COALESCE(
          end_date,
          (SELECT max(c.date) FROM charges c WHERE c.charging_process_id = charging_processes.id)
        ) AT TIME ZONE 'UTC',
        ($1::timestamp + interval '1 day') AT TIME ZONE 'Europe/Prague'
      ) - ($1::timestamp AT TIME ZONE 'Europe/Prague')
    )) / 60 AS to_minute
  FROM charging_processes
  WHERE car_id = 1
    AND (start_date AT TIME ZONE 'UTC') < (($1::timestamp + interval '1 day') AT TIME ZONE 'Europe/Prague')
    AND COALESCE(
      end_date,
      (SELECT max(c.date) FROM charges c WHERE c.charging_process_id = charging_processes.id)
    ) AT TIME ZONE 'UTC' > ($1::timestamp AT TIME ZONE 'Europe/Prague')
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
    plugged: plugged.map((row) => ({
      fromMinute: Number(row.from_minute),
      toMinute: Number(row.to_minute)
    }))
  });
}
