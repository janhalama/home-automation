/*
The wallbox permission around a booked car slot.
Fifteen minutes is one price quarter. The Tesla schedule stays on the booked clocks.
*/

const MARGIN_MINUTES = 15;
const DAY_MINUTES = 24 * 60;

export type WallboxWindow = { from: string; to: string };

function minutes(clock: string): number {
  const [hour, minute] = clock.split(":");
  return Number(hour) * 60 + Number(minute);
}

function clock(total: number): string {
  const wrapped = ((total % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const hour = String(Math.floor(wrapped / 60)).padStart(2, "0");
  const minute = String(wrapped % 60).padStart(2, "0");
  return `${hour}:${minute}`;
}

/* True when the booked end is on the next morning. 24:00 is that midnight. */
function crossesMidnight(from: string, to: string): boolean {
  return minutes(to) <= minutes(from);
}

/* The clocks the Miniserver uses. A start that would fall on the previous day stays at 00:00. */
export function wallboxWindow(from: string, to: string): WallboxWindow {
  const start = minutes(from);
  const end = to === "24:00" ? DAY_MINUTES : minutes(to);
  const opened = start - MARGIN_MINUTES;
  const closed = end + MARGIN_MINUTES;
  if (!crossesMidnight(from, to) && opened < 0)
    return { from: "00:00", to: clock(closed) };
  return { from: clock(opened), to: clock(closed) };
}
