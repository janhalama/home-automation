/*
Whether this poll writes a one-time charge schedule to the car.
A grid slot whose start is still ahead is the schedule. A start that has passed is the missed charge and is not sent.
*/

import type { DecisionSegment } from "./day-decision.js";

export type CarSchedule = { id: number; from: string; to: string };

export type CarScheduleAction =
  | { action: "add"; slot: { from: string; to: string } }
  | { action: "remove" }
  | { action: "keep" };

/* Clock HH:MM to minutes after midnight. */
function minutes(clock: string): number {
  const [hour, minute] = clock.split(":");
  return Number(hour) * 60 + Number(minute);
}

/* The earliest grid slot that has not started. 24:00 is the end of the day, not a start. */
function nextGridSlot(segments: DecisionSegment[], now: string): { from: string; to: string } | null {
  const at = minutes(now);
  const ahead = segments
    .filter((segment) => segment.kind === "car" && segment.mode === "grid" && minutes(segment.from) > at)
    .sort((left, right) => minutes(left.from) - minutes(right.from));
  return ahead[0] ? { from: ahead[0].from, to: ahead[0].to } : null;
}

/* Add, replace, remove, or keep. A null car reading is not a reason to remove. */
export function carScheduleAction(input: {
  segments: DecisionSegment[];
  sent: CarSchedule | null;
  now: string;
  carAtHome: boolean | null;
  carMissingKwh: number | null;
}): CarScheduleAction {
  const readingMissing = input.carAtHome === null || input.carMissingKwh === null;
  const finished = !readingMissing && (input.carAtHome === false || input.carMissingKwh <= 0);
  if (finished)
    return input.sent ? { action: "remove" } : { action: "keep" };
  const slot = nextGridSlot(input.segments, input.now);
  if (!slot)
    return { action: "keep" };
  if (input.sent && input.sent.from === slot.from && input.sent.to === slot.to)
    return { action: "keep" };
  return { action: "add", slot };
}
