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

/* Same kind, hours, power, and mode. */
function sameSegment(left: DecisionSegment, right: DecisionSegment): boolean {
  return left.kind === right.kind
    && left.from === right.from
    && left.to === right.to
    && left.kw === right.kw
    && left.mode === right.mode;
}

/* True when the inner window sits inside the outer one, edges included. */
function contains(outer: DecisionSegment, inner: DecisionSegment): boolean {
  return minutes(inner.from) >= minutes(outer.from) && minutes(inner.to) <= minutes(outer.to);
}

/* The car windows to keep. A shorter window inside one already issued is the same plan sliding forward, so the issued hours stay. A clock poll that finds no slot leaves the issued window in place. */
function chosenCars(stored: DecisionSegment[], proposed: DecisionSegment[], now: string, holdOpenCar: boolean): DecisionSegment[] {
  const storedCars = stored.filter((segment) => segment.kind === "car");
  const proposedCars = proposed.filter((segment) => segment.kind === "car");
  const started = storedCars.filter((segment) => hasStarted(segment, now));
  const waiting = storedCars.filter((segment) => !hasStarted(segment, now) && minutes(segment.to) > minutes(now));
  const outside = proposedCars.filter((segment) => !storedCars.some((other) => sameSegment(other, segment) || contains(other, segment)));
  if (outside.length > 0)
    return [...started, ...outside];
  const slide = proposedCars.length > 0;
  const open = waiting.filter(() => holdOpenCar || slide);
  const covered = [...started, ...open];
  const fresh = proposedCars.filter((segment) =>
    hasStarted(segment, now)
    && !covered.some((other) => sameSegment(other, segment) || contains(other, segment))
  );
  return [...covered, ...fresh];
}

/* Keep started hours, take the proposal for the rest, and mark a wait where the tank or car is on. holdOpenCar keeps a car the clock has not reached when this poll found no slot. */
export function mergeDecision(stored: DecisionSegment[], proposed: DecisionSegment[], now: string, holdOpenCar = false): DecisionSegment[] {
  const proposedLive = proposed.filter((segment) => segment.kind !== "battery-wait" && segment.kind !== "car");
  const kept = stored.filter((segment) => segment.kind !== "battery-wait" && segment.kind !== "car" && hasStarted(segment, now));
  const startedProposed = proposedLive.filter((segment) =>
    hasStarted(segment, now)
    && !kept.some((other) => other.kind === segment.kind && other.from === segment.from)
  );
  const ahead = proposedLive.filter((segment) => !hasStarted(segment, now));
  const merged = [...kept, ...startedProposed, ...ahead, ...chosenCars(stored, proposed, now, holdOpenCar)];
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

/* True when the only input that moved is the minute. */
export function clockOnlyChange(previous: PlanInputs, next: PlanInputs): boolean {
  return triggerName(previous, next) === "The clock";
}

/* Drop waiting cars a later replan replaced. A car that had already started stays on the day. */
function forgetReplanned(slid: DecisionSegment[], change: PlanChange, next: DecisionSegment[]): void {
  const at = minutes(change.at);
  const cancel = change.trigger === "Car no longer needs a charge" || change.trigger === "Night charging turned off";
  for (let index = slid.length - 1; index >= 0; index -= 1) {
    const car = slid[index];
    const waiting = minutes(car.from) >= at;
    const stillThere = next.some((segment) => sameSegment(segment, car) || contains(car, segment));
    if (waiting && (cancel || (next.length > 0 && !stillThere)))
      slid.splice(index, 1);
  }
}

/* Car windows a clock poll replaced or deleted. The widest issued window is the one the day shows. Changes are newest first, as the archive returns them. */
export function carsSlidAway(changes: PlanChange[]): DecisionSegment[] {
  const ordered = [...changes].reverse();
  let current: DecisionSegment[] = [];
  const slid: DecisionSegment[] = [];
  for (const change of ordered) {
    const next = change.segments.filter((segment) => segment.kind === "car");
    if (change.trigger === "The clock") {
      for (const car of current) {
        if (!next.some((segment) => sameSegment(segment, car)) && minutes(change.at) < minutes(car.to))
          slid.push(car);
      }
    } else {
      forgetReplanned(slid, change, next);
    }
    current = next;
  }
  return slid.filter((car, index) => !slid.some((other, otherIndex) =>
    otherIndex !== index && contains(other, car) && !sameSegment(other, car)
  ));
}

/* The decision to save. A car the clock slid away is put back, then the proposal is merged. */
export function settleDecision(
  stored: DecisionSegment[],
  proposed: DecisionSegment[],
  now: string,
  changes: PlanChange[],
  holdOpenCar: boolean
): DecisionSegment[] {
  const base = [...stored];
  for (const car of carsSlidAway(changes)) {
    if (!base.some((segment) => segment.kind === "car" && sameSegment(segment, car)))
      base.push(car);
  }
  return mergeDecision(base, proposed, now, holdOpenCar);
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
