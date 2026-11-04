/*
The shortest run of quarter-hour prices that can finish a job.
A longer run is used only when no shorter run can hold the energy.
A run may cross midnight when today is joined to the next morning.
*/

export type PriceQuarter = {
  periodInterval: string;
  eurPerMwh: number;
};

export type Slot = {
  from: string;
  to: string;
};

const MINUTES_PER_DAY = 24 * 60;
const MORNING_END = "06:00";

type PlacedQuarter = PriceQuarter & {
  fromMin: number;
  toMin: number;
  from: string;
  to: string;
};

/* Clock HH:MM to minutes after midnight. 24:00 is the end of the day. */
function minutes(clock: string): number {
  const [hour, minute] = clock.split(":");
  return Number(hour) * 60 + Number(minute);
}

/* Split one OTE interval into its start and end clocks. */
function bounds(periodInterval: string): { from: string; to: string } {
  const [from, to] = periodInterval.split("-");
  return { from, to };
}

/* Place each quarter on a minute line. 24:00 sits on the next midnight. */
function place(intervals: PriceQuarter[], dayOffset: number): PlacedQuarter[] {
  return intervals.map((quarter) => {
    const edge = bounds(quarter.periodInterval);
    const origin = dayOffset * MINUTES_PER_DAY;
    return {
      ...quarter,
      from: edge.from,
      to: edge.to,
      fromMin: minutes(edge.from) + origin,
      toMin: minutes(edge.to) + origin
    };
  });
}

/* The cheapest contiguous run of exactly the quarters this energy needs. */
function cheapestRun(ordered: PlacedQuarter[], kwh: number, powerKw: number): Slot | null {
  if (kwh <= 0 || powerKw <= 0)
    return null;
  const count = Math.ceil(kwh / powerKw / 0.25);
  let best: { cost: number; from: string; to: string } | null = null;
  for (let start = 0; start <= ordered.length - count; start += 1) {
    const window = ordered.slice(start, start + count);
    const contiguous = window.every((quarter, index) =>
      index === 0 || window[index - 1].toMin === quarter.fromMin
    );
    if (!contiguous)
      continue;
    const cost = window.reduce((sum, quarter) => sum + quarter.eurPerMwh, 0);
    if (!best || cost < best.cost)
      best = { cost, from: window[0].from, to: window[window.length - 1].to };
  }
  if (!best)
    return null;
  return { from: best.from, to: best.to };
}

/* The cheapest contiguous run long enough for the energy at the given power. */
export function cheapestSlot(
  intervals: PriceQuarter[],
  kwh: number,
  powerKw: number,
  endBy: string | null,
  startAt: string | null = null
): Slot | null {
  const startMin = startAt === null ? null : minutes(startAt);
  const endMin = endBy === null ? null : minutes(endBy);
  const ordered = place(intervals, 0)
    .filter((quarter) => startMin === null || quarter.toMin > startMin)
    .filter((quarter) => endMin === null || quarter.toMin <= endMin)
    .sort((left, right) => left.fromMin - right.fromMin);
  return cheapestRun(ordered, kwh, powerKw);
}

/* Today's remaining quarters joined to tomorrow through 06:00. 24:00 meets 00:00. */
export function cheapestSlotAcrossMidnight(
  before: PriceQuarter[],
  after: PriceQuarter[],
  kwh: number,
  powerKw: number,
  startAt: string
): Slot | null {
  const startMin = minutes(startAt);
  const deadline = MINUTES_PER_DAY + minutes(MORNING_END);
  const today = place(before, 0).filter((quarter) => quarter.toMin > startMin);
  const tomorrow = place(after, 1).filter((quarter) => quarter.toMin <= deadline);
  const ordered = [...today, ...tomorrow].sort((left, right) => left.fromMin - right.fromMin);
  return cheapestRun(ordered, kwh, powerKw);
}
