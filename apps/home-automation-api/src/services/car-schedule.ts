/*
Whether this poll writes a one-time charge schedule to the car.
A grid window that still covers now stays. Otherwise the earliest grid start still ahead is the schedule.
*/

import type { DecisionSegment } from "./day-decision.js";

export type CarSchedule = { id: number; from: string; to: string };

export type CarScheduleAction =
  | { action: "add"; slot: { from: string; to: string } }
  | { action: "remove" }
  | { action: "keep" };

/* Clock HH:MM to minutes after midnight. 24:00 is minute 1440. */
function minutes(clock: string): number {
  const [hour, minute] = clock.split(":");
  return Number(hour) * 60 + Number(minute);
}

/* True when this from/to still contains now. An end at or before the start crosses midnight. */
function coversNow(from: string, to: string, now: string): boolean {
  const start = minutes(from);
  const end = minutes(to);
  const at = minutes(now);
  if (end <= start)
    return at >= start || at < end;
  return start <= at && at < end;
}

/* Grid car windows, earliest start first. */
function gridSlots(segments: DecisionSegment[]): DecisionSegment[] {
  return segments
    .filter((segment) => segment.kind === "car" && segment.mode === "grid")
    .sort((left, right) => minutes(left.from) - minutes(right.from));
}

/* The grid window that contains now. The earliest such start wins. */
function openGridSlot(segments: DecisionSegment[], now: string): { from: string; to: string } | null {
  const open = gridSlots(segments).find((segment) => coversNow(segment.from, segment.to, now));
  return open ? { from: open.from, to: open.to } : null;
}

/* The earliest grid slot that has not started. 24:00 is the end of the day, not a start. */
function nextGridSlot(segments: DecisionSegment[], now: string): { from: string; to: string } | null {
  const at = minutes(now);
  const ahead = gridSlots(segments).find((segment) => minutes(segment.from) > at);
  return ahead ? { from: ahead.from, to: ahead.to } : null;
}

/* Same from and to the car was already given. */
function sameWindow(sent: CarSchedule, slot: { from: string; to: string }): boolean {
  return sent.from === slot.from && sent.to === slot.to;
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
  const chargeFinished = input.carMissingKwh !== null && input.carMissingKwh <= 0;
  const finished = !readingMissing && (input.carAtHome === false || chargeFinished);
  if (finished)
    return input.sent ? { action: "remove" } : { action: "keep" };
  if (input.sent && coversNow(input.sent.from, input.sent.to, input.now))
    return { action: "keep" };
  const open = openGridSlot(input.segments, input.now);
  if (open)
    return input.sent && sameWindow(input.sent, open) ? { action: "keep" } : { action: "add", slot: open };
  const slot = nextGridSlot(input.segments, input.now);
  if (!slot)
    return { action: "keep" };
  if (input.sent && sameWindow(input.sent, slot))
    return { action: "keep" };
  return { action: "add", slot };
}
