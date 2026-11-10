/*
The minutes when forecast PV meets the house, and when it falls below again.
The crossing is the straight line between the two surrounding hours.
*/

export type SunPoint = {
  at: string;
  pvKw: number;
  houseKw: number;
};

export type SunCover = {
  from: string;
  to: string;
};

/* Minutes after midnight from a timestamp. */
function clockMinutes(at: string): number {
  const match = /(\d{2}):(\d{2})/.exec(at.slice(11));
  if (!match)
    throw new Error(`The sun time is missing: ${at}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/* HH:MM from minutes after midnight. */
function clock(total: number): string {
  const minutes = ((Math.round(total) % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/* Where the two lines cross, as a fraction of the step from the first point to the second. */
function crossFraction(before: SunPoint, after: SunPoint): number {
  const closing = (after.pvKw - before.pvKw) - (after.houseKw - before.houseKw);
  if (closing === 0)
    return before.pvKw >= before.houseKw ? 0 : 1;
  const raw = (before.houseKw - before.pvKw) / closing;
  return Math.min(1, Math.max(0, raw));
}

/* Clock between two timestamps. */
function clockBetween(before: string, after: string, fraction: number): string {
  const start = clockMinutes(before);
  let span = clockMinutes(after) - start;
  if (span <= 0)
    span += 24 * 60;
  return clock(start + span * fraction);
}

/* The longest run where the forecast is at least the house. */
export function sunCoverWindow(points: SunPoint[]): SunCover | null {
  const ordered = [...points].sort((left, right) => left.at.localeCompare(right.at));
  let best: { start: number; end: number } | null = null;
  let run: { start: number; end: number } | null = null;
  const prefer = (candidate: { start: number; end: number }, current: { start: number; end: number } | null) => {
    if (!current || candidate.end - candidate.start > current.end - current.start)
      return candidate;
    return current;
  };
  for (let index = 0; index < ordered.length; index += 1) {
    const covers = ordered[index].pvKw >= ordered[index].houseKw;
    if (covers && run)
      run.end = index;
    else if (covers)
      run = { start: index, end: index };
    else if (run) {
      best = prefer(run, best);
      run = null;
    }
  }
  if (run)
    best = prefer(run, best);
  if (!best)
    return null;
  const first = ordered[best.start];
  const last = ordered[best.end];
  const earlier = best.start > 0 ? ordered[best.start - 1] : null;
  const later = best.end + 1 < ordered.length ? ordered[best.end + 1] : null;
  const from = earlier && earlier.pvKw < earlier.houseKw
    ? clockBetween(earlier.at, first.at, crossFraction(earlier, first))
    : first.at.slice(11, 16);
  const to = later && later.pvKw < later.houseKw
    ? clockBetween(last.at, later.at, crossFraction(last, later))
    : last.at.slice(11, 16);
  return { from, to };
}

export type SunCoverSeries = {
  from: string | null;
  to: string | null;
  points: { time: string; pvKw: number; houseKw: number }[];
};

/* Middle house rate, used for an hour the last week did not sample. */
function typicalHouseKw(demand: Map<string, number>): number | null {
  const values = [...demand.values()].sort((left, right) => left - right);
  if (values.length === 0)
    return null;
  const middle = Math.floor(values.length / 2);
  if (values.length % 2 === 1)
    return values[middle];
  return (values[middle - 1] + values[middle]) / 2;
}

/* Pair each forecast hour with that hour's house demand. */
export function alignSunCover(
  hours: { at: string; pvKw: number }[],
  demand: Map<string, number>
): SunCoverSeries {
  const typical = typicalHouseKw(demand);
  const detailed = hours.flatMap((hour) => {
    const houseKw = demand.get(hour.at.slice(11, 13)) ?? typical;
    if (houseKw === null)
      return [];
    return [{ at: hour.at, pvKw: hour.pvKw, houseKw }];
  });
  const cover = sunCoverWindow(detailed);
  return {
    from: cover?.from ?? null,
    to: cover?.to ?? null,
    points: detailed.map((point) => ({
      time: point.at.slice(11, 16),
      pvKw: point.pvKw,
      houseKw: point.houseKw
    }))
  };
}
