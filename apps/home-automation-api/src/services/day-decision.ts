/*
Keeps a decision that has started, and names why the hours still ahead changed.
The page stores the result. The planner only proposes.
*/

export type DecisionKind = "tank" | "car" | "battery-buy" | "battery-sell" | "battery-wait";

export type DecisionSegment = {
  kind: DecisionKind;
  from: string;
  to: string;
  kw: number;
  mode: "" | "grid" | "battery" | "surplus";
};

export type PlanInputs = {
  bookedChargeEnded: boolean;
  clock: string;
  todayPrices: string;
  tomorrowPricesArrived: boolean;
  tankC: number | null;
  carAtHome: boolean;
  carMissingKwh: number;
  nightCharging: boolean;
  socPercent: number | null;
  expectedSunKwh: number | null;
  nightHouseKwh: number;
  daylightHouseKwh: number;
  season: string;
};

export type PlanChangeLine = {
  at: string;
  trigger: string;
  result: string;
  segments: DecisionSegment[];
};

export type PlanChange = PlanChangeLine;

const TANK_TARGET_C = 55;

/* Minutes after midnight for an HH:MM clock. */
function minutes(clock: string): number {
  const [hour, minute] = clock.split(":");
  return Number(hour) * 60 + Number(minute);
}

/* True when this minute sits inside the segment. The end minute is not included. */
function covers(segment: DecisionSegment, at: number): boolean {
  const start = minutes(segment.from);
  const end = minutes(segment.to);
  return at >= start && at < end;
}

/* A segment that has already started stays through its end. */
function hasStarted(segment: DecisionSegment, now: string): boolean {
  return minutes(segment.from) < minutes(now);
}

/* Future segments in the order the page draws them. */
function futureOf(segments: DecisionSegment[], now: string): DecisionSegment[] {
  return segments.filter((segment) => !hasStarted(segment, now) && segment.kind !== "battery-wait");
}

/* Same hours, kind, power, and mode. */
function sameSegments(left: DecisionSegment[], right: DecisionSegment[]): boolean {
  if (left.length !== right.length)
    return false;
  return left.every((segment, index) => {
    const other = right[index];
    return segment.kind === other.kind
      && segment.from === other.from
      && segment.to === other.to
      && segment.kw === other.kw
      && segment.mode === other.mode;
  });
}

/* Minutes of a tank or car window that no battery buy covers. */
function uncoveredWait(segment: DecisionSegment, buys: DecisionSegment[]): DecisionSegment[] {
  const start = minutes(segment.from);
  const end = minutes(segment.to);
  const waits: DecisionSegment[] = [];
  let open: number | null = null;
  for (let at = start; at < end; at += 1) {
    const covered = buys.some((buy) => covers(buy, at));
    if (!covered && open === null)
      open = at;
    if ((covered || at + 1 === end) && open !== null) {
      const close = covered ? at : end;
      waits.push({
        kind: "battery-wait",
        from: clock(open),
        to: clock(close),
        kw: 0,
        mode: ""
      });
      open = null;
    }
  }
  return waits;
}

/* HH:MM for minutes after midnight. */
function clock(total: number): string {
  const hour = String(Math.floor(total / 60)).padStart(2, "0");
  const minute = String(total % 60).padStart(2, "0");
  return `${hour}:${minute}`;
}

/* Keep started hours, take the proposal for the rest, and mark a wait where the tank or car is on. */
export function mergeDecision(stored: DecisionSegment[], proposed: DecisionSegment[], now: string): DecisionSegment[] {
  const proposedLive = proposed.filter((segment) => segment.kind !== "battery-wait");
  const kept = stored.filter((segment) => segment.kind !== "battery-wait" && hasStarted(segment, now));
  const startedProposed = proposedLive.filter((segment) =>
    hasStarted(segment, now)
    && !kept.some((other) => other.kind === segment.kind && other.from === segment.from)
  );
  const ahead = proposedLive.filter((segment) => !hasStarted(segment, now));
  const merged = [...kept, ...startedProposed, ...ahead];
  const buys = merged.filter((segment) => segment.kind === "battery-buy");
  const waits = merged
    .filter((segment) => segment.kind === "tank" || segment.kind === "car")
    .flatMap((segment) => uncoveredWait(segment, buys));
  return [...merged, ...waits];
}

/* One sentence for the future hours that are not the same. */
function resultSentence(before: DecisionSegment[], after: DecisionSegment[]): string {
  const changed = after.filter((segment) => !before.some((other) => sameSegments([segment], [other])));
  if (changed.length === 0)
    return "The hours still ahead changed.";
  return changed.map(describeSegment).join(" ");
}

/* Hours and mode for one future segment. */
function describeSegment(segment: DecisionSegment): string {
  if (segment.kind === "tank")
    return `Tank ${segment.from}–${segment.to}.`;
  if (segment.kind === "car")
    return `Car ${segment.mode} ${segment.from}–${segment.to}.`;
  if (segment.kind === "battery-buy")
    return `Battery buy ${segment.from}–${segment.to} at ${segment.kw} kW.`;
  if (segment.kind === "battery-sell")
    return `Battery sale ${segment.from}–${segment.to}.`;
  return `Battery waits ${segment.from}–${segment.to}.`;
}

/* The first input that differs. The clock is last: a later poll always has a new minute, so the line names the tank, the prices, or the car when one of those moved too. */
function triggerName(previous: PlanInputs, next: PlanInputs): string | null {
  if (next.bookedChargeEnded && !previous.bookedChargeEnded)
    return "Booked charge ended";
  if (previous.todayPrices !== next.todayPrices)
    return "Today's prices";
  if (!previous.tomorrowPricesArrived && next.tomorrowPricesArrived)
    return "Tomorrow's prices arrived";
  if ((previous.tankC === null || previous.tankC >= TANK_TARGET_C) && next.tankC !== null && next.tankC < TANK_TARGET_C)
    return "Tank fell below 55°C";
  if (previous.tankC !== null && previous.tankC < TANK_TARGET_C && next.tankC !== null && next.tankC >= TANK_TARGET_C)
    return "Tank reached 55°C";
  if (!previous.carAtHome && next.carAtHome && next.carMissingKwh > 0)
    return "Car plugged in";
  if ((previous.carAtHome && !next.carAtHome) || (previous.carMissingKwh > 0 && next.carMissingKwh <= 0))
    return "Car no longer needs a charge";
  if (previous.nightCharging && !next.nightCharging)
    return "Night charging turned off";
  if (!previous.nightCharging && next.nightCharging)
    return "Night charging turned on";
  if (previous.socPercent !== next.socPercent)
    return "Battery state of charge";
  if (previous.expectedSunKwh !== next.expectedSunKwh)
    return "Expected sun";
  if (previous.nightHouseKwh !== next.nightHouseKwh || previous.daylightHouseKwh !== next.daylightHouseKwh)
    return "Recent house use";
  if (previous.season !== next.season)
    return "Season";
  if (previous.clock !== next.clock)
    return "The clock";
  return null;
}

/* A line when the hours still ahead changed, carrying the plan as it stood afterwards. */
export function futureChange(
  before: DecisionSegment[],
  after: DecisionSegment[],
  previousInputs: PlanInputs,
  nextInputs: PlanInputs
): PlanChangeLine | null {
  const previousFuture = futureOf(before, nextInputs.clock);
  const nextFuture = futureOf(after, nextInputs.clock);
  if (sameSegments(previousFuture, nextFuture))
    return null;
  const trigger = triggerName(previousInputs, nextInputs);
  if (!trigger)
    return null;
  return {
    at: nextInputs.clock,
    trigger,
    result: resultSentence(previousFuture, nextFuture),
    segments: after
  };
}
