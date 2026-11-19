/*
A booked grid charge stays until its clock or its energy is done.
A later proposal may book the next window. It does not replace the one still open.
A sample inside the window that is not charging is a fault. The window stays.
*/

export type ChargeWindow = {
  from: string;
  to: string;
  kw: number;
  kwh: number;
};

export type ChargeSample = {
  clock: string;
  batteryKw: number;
};

export type KeptCharge = {
  active: ChargeWindow | null;
  booked: ChargeWindow[];
  fault: boolean;
};

const QUARTER_HOURS = 0.25;
const CHARGE_SEEN_KW = 0.5;

/* Clock HH:MM to minutes after midnight. */
function minutes(clock: string): number {
  const [hour, minute] = clock.split(":");
  return Number(hour) * 60 + Number(minute);
}

/* Hours from the start clock to the end clock. A window may cross midnight. */
function spanHours(from: string, to: string): number {
  const start = minutes(from);
  let end = minutes(to);
  if (end <= start)
    end += 24 * 60;
  return (end - start) / 60;
}

/* The window a proposal books. The energy is the power times the length. */
export function chargeWindow(from: string, to: string, kw: number): ChargeWindow {
  return { from, to, kw, kwh: kw * spanHours(from, to) };
}

/* True when this clock sits inside the window. The end minute is excluded. */
function contains(window: ChargeWindow, clock: string): boolean {
  const at = minutes(clock);
  const from = minutes(window.from);
  const to = minutes(window.to);
  if (from === to)
    return false;
  if (to > from)
    return at >= from && at < to;
  return at >= from || at < to;
}

/* True when the clock has reached the end of the window. */
function clockHasPassed(window: ChargeWindow, now: string): boolean {
  const at = minutes(now);
  const from = minutes(window.from);
  const to = minutes(window.to);
  if (to > from)
    return at >= to;
  return at >= to && at < from;
}

/* Kilowatt-hours already into the pack during the window. Each sample is one quarter. */
function energyTaken(window: ChargeWindow, samples: ChargeSample[]): number {
  return samples
    .filter((sample) => contains(window, sample.clock))
    .reduce((sum, sample) => sum + Math.max(0, -sample.batteryKw) * QUARTER_HOURS, 0);
}

/* True when the clock or the energy has finished this window. */
function hasEnded(window: ChargeWindow, now: string, samples: ChargeSample[]): boolean {
  return clockHasPassed(window, now) || energyTaken(window, samples) >= window.kwh;
}

/* The latest sample whose clock sits inside the window. */
function latestInside(window: ChargeWindow, samples: ChargeSample[]): ChargeSample | null {
  return samples.reduce<ChargeSample | null>((latest, sample) => {
    if (!contains(window, sample.clock))
      return latest;
    if (!latest || minutes(sample.clock) >= minutes(latest.clock))
      return sample;
    return latest;
  }, null);
}

/* Keep the open booking, or take a proposal that has not already ended. */
export function keepChargeWindow(
  booked: ChargeWindow[],
  proposed: ChargeWindow | null,
  now: string,
  samples: ChargeSample[]
): KeptCharge {
  const open = booked.find((window) => !hasEnded(window, now, samples)) ?? null;
  const sameAsEnded = proposed !== null && booked.some((window) => window.from === proposed.from && window.to === proposed.to);
  const history = open || !proposed || sameAsEnded ? booked : [...booked, proposed];
  const active = open ?? (history.length > booked.length ? proposed : null);
  const reading = active ? latestInside(active, samples) : null;
  const fault = Boolean(active && contains(active, now) && reading && reading.batteryKw > -CHARGE_SEEN_KW);
  return { active, booked: history, fault };
}
