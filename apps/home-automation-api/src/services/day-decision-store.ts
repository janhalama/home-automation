/*
The issued decision for a day, and the line written when the hours still ahead change.
*/

import type { DatabaseSync } from "node:sqlite";
import type { DecisionSegment, PlanChange, PlanInputs } from "./day-decision.js";

type DecisionRow = {
  kind: DecisionSegment["kind"];
  from_clock: string;
  to_clock: string;
  kw: number;
  mode: DecisionSegment["mode"];
};

/* Refuse a payload that is not the input set the next poll compares. */
function parsePlanInputs(payload: string): PlanInputs {
  const value = JSON.parse(payload) as Partial<PlanInputs>;
  if (typeof value.clock !== "string" || typeof value.todayPrices !== "string" || typeof value.season !== "string")
    throw new Error("Stored plan inputs are unreadable");
  return value as PlanInputs;
}

/* Map stored rows onto the segment the rest of the API uses. */
function readDecisionRows(rows: DecisionRow[]): DecisionSegment[] {
  return rows.map((row) => ({
    kind: row.kind,
    from: row.from_clock,
    to: row.to_clock,
    kw: row.kw,
    mode: row.mode
  }));
}

/* Read and replace the decision, and append a change without deleting older lines. */
export function decisionStore(database: DatabaseSync) {
  const listDecisions = database.prepare(`
    SELECT kind, from_clock, to_clock, kw, mode
    FROM day_decisions
    WHERE date = ?
    ORDER BY rowid
  `);
  const deleteDecisions = database.prepare(`DELETE FROM day_decisions WHERE date = ?`);
  const insertDecision = database.prepare(`
    INSERT INTO day_decisions (date, kind, from_clock, to_clock, kw, mode)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const listChanges = database.prepare(`
    SELECT id, at, trigger, result
    FROM plan_changes
    WHERE date = ?
    ORDER BY id DESC
  `);
  const listChangeSegments = database.prepare(`
    SELECT kind, from_clock, to_clock, kw, mode
    FROM plan_change_segments
    WHERE change_id = ?
    ORDER BY rowid
  `);
  const insertChange = database.prepare(`
    INSERT INTO plan_changes (date, at, trigger, result)
    VALUES (?, ?, ?, ?)
  `);
  const insertChangeSegment = database.prepare(`
    INSERT INTO plan_change_segments (change_id, kind, from_clock, to_clock, kw, mode)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const readInputs = database.prepare(`SELECT payload FROM plan_inputs WHERE date = ?`);
  const saveInputs = database.prepare(`
    INSERT INTO plan_inputs (date, payload)
    VALUES (?, ?)
    ON CONFLICT(date) DO UPDATE SET payload = excluded.payload
  `);

  return {
    listDayDecisions(date: string) {
      return readDecisionRows(listDecisions.all(date) as DecisionRow[]);
    },
    saveDayDecisions(date: string, segments: DecisionSegment[]) {
      database.exec("BEGIN");
      deleteDecisions.run(date);
      for (const segment of segments)
        insertDecision.run(date, segment.kind, segment.from, segment.to, segment.kw, segment.mode);
      database.exec("COMMIT");
    },
    listPlanChanges(date: string) {
      const rows = listChanges.all(date) as Array<{ id: number; at: string; trigger: string; result: string }>;
      return rows.map((row): PlanChange => ({
        at: row.at,
        trigger: row.trigger,
        result: row.result,
        segments: readDecisionRows(listChangeSegments.all(row.id) as DecisionRow[])
      }));
    },
    appendPlanChange(date: string, change: PlanChange) {
      database.exec("BEGIN");
      const inserted = insertChange.run(date, change.at, change.trigger, change.result);
      const changeId = Number(inserted.lastInsertRowid);
      for (const segment of change.segments)
        insertChangeSegment.run(changeId, segment.kind, segment.from, segment.to, segment.kw, segment.mode);
      database.exec("COMMIT");
    },
    readPlanInputs(date: string) {
      const row = readInputs.get(date) as { payload: string } | undefined;
      if (!row)
        return null;
      return parsePlanInputs(row.payload);
    },
    savePlanInputs(date: string, inputs: PlanInputs) {
      saveInputs.run(date, JSON.stringify(inputs));
    }
  };
}
