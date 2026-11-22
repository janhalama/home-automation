/*
The one charge window this house has already sent to the car.
*/

import type { DatabaseSync } from "node:sqlite";
import type { CarSchedule } from "./car-schedule.js";

type ScheduleRow = {
  from_clock: string;
  to_clock: string;
};

/* Read, replace, or forget that window. The table holds a single row, id 1. */
export function carScheduleStore(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS car_schedule (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      from_clock TEXT NOT NULL,
      to_clock TEXT NOT NULL
    )
  `);
  const readRow = database.prepare(`
    SELECT from_clock, to_clock FROM car_schedule WHERE id = 1
  `);
  const replaceRow = database.prepare(`
    INSERT INTO car_schedule (id, from_clock, to_clock)
    VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      from_clock = excluded.from_clock,
      to_clock = excluded.to_clock
  `);
  const deleteRow = database.prepare(`DELETE FROM car_schedule WHERE id = 1`);

  return {
    read(): CarSchedule | null {
      const row = readRow.get() as ScheduleRow | undefined;
      if (!row)
        return null;
      return { id: 1, from: row.from_clock, to: row.to_clock };
    },
    save(schedule: CarSchedule) {
      replaceRow.run(schedule.from, schedule.to);
    },
    clear() {
      deleteRow.run();
    }
  };
}
