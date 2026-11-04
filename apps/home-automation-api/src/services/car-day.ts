/*
One Prague day of the car: wallbox charging, state of charge, and plugged-in.
The grid is 15 minutes so the plan can be drawn even when the car was still.
*/

export type CarPoint = {
  time: string;
  chargeKw: number | null;
  socPercent: number | null;
  pluggedIn: boolean;
};

const QUARTERS = 96;

/* Clock HH:MM:SS to minutes after midnight. */
function minutes(clock: string): number {
  const [hour, minute, second] = clock.split(":");
  return Number(hour) * 60 + Number(minute) + Number(second ?? 0) / 60;
}

/* Quarter index for a clock, clamped to the day. */
function quarterIndex(clock: string): number {
  return Math.min(QUARTERS - 1, Math.max(0, Math.floor(minutes(clock) / 15)));
}

/* Clock at the start of a quarter. */
function quarterClock(index: number): string {
  const total = index * 15;
  const hour = String(Math.floor(total / 60)).padStart(2, "0");
  const minute = String(total % 60).padStart(2, "0");
  return `${hour}:${minute}:00`;
}

/* Place charge peaks, the latest state of charge, and plug windows onto the 96 quarters. */
export function buildCarDay(input: {
  charges: { time: string; chargeKw: number }[];
  levels: { time: string; socPercent: number }[];
  plugged: { fromMinute: number; toMinute: number }[];
}): CarPoint[] {
  const chargeKw = Array.from({ length: QUARTERS }, () => null as number | null);
  const socPercent = Array.from({ length: QUARTERS }, () => null as number | null);
  const socAt = Array.from({ length: QUARTERS }, () => -1);
  const pluggedIn = Array.from({ length: QUARTERS }, () => false);

  for (const charge of input.charges) {
    const index = quarterIndex(charge.time);
    const current = chargeKw[index];
    chargeKw[index] = current === null ? charge.chargeKw : Math.max(current, charge.chargeKw);
  }
  for (const level of input.levels) {
    const index = quarterIndex(level.time);
    const at = minutes(level.time);
    if (at >= socAt[index]) {
      socAt[index] = at;
      socPercent[index] = level.socPercent;
    }
  }
  for (const window of input.plugged) {
    for (let index = 0; index < QUARTERS; index += 1) {
      const start = index * 15;
      const end = start + 15;
      if (window.fromMinute < end && window.toMinute > start)
        pluggedIn[index] = true;
    }
  }

  return Array.from({ length: QUARTERS }, (_, index) => ({
    time: quarterClock(index),
    chargeKw: chargeKw[index],
    socPercent: socPercent[index],
    pluggedIn: pluggedIn[index]
  }));
}
