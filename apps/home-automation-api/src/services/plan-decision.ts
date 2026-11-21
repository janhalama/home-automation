/*
The route's view of one day: merge the proposal, keep what already started,
and turn that decision back into the tank and car fields the Miniserver reads.
The battery command stays on the plan the charge rule already produced.
*/

import {
  clockOnlyChange,
  futureChange,
  settleDecision,
  type DecisionKind,
  type DecisionSegment,
  type PlanChange,
  type PlanInputs
} from "./day-decision.js";
import type { EnergyPlan } from "./energy-plan.js";

const TANK_KW = 2.5;

export type DecisionArchive = {
  listDayDecisions(date: string): DecisionSegment[];
  saveDayDecisions(date: string, segments: DecisionSegment[]): void;
  listPlanChanges(date: string): PlanChange[];
  appendPlanChange(date: string, change: PlanChange): void;
  readPlanInputs(date: string): PlanInputs | null;
  savePlanInputs(date: string, inputs: PlanInputs): void;
};

/* Minutes after midnight for an HH:MM clock. */
function minutes(clock: string): number {
  const [hour, minute] = clock.split(":");
  return Number(hour) * 60 + Number(minute);
}

/* The window that covers this minute, otherwise the next one that has not started. */
function coveringOrNext(segments: DecisionSegment[], kind: DecisionKind, now: string): DecisionSegment | null {
  const rows = segments.filter((segment) => segment.kind === kind);
  const at = minutes(now);
  const covering = rows.find((segment) => minutes(segment.from) <= at && at < minutes(segment.to));
  if (covering)
    return covering;
  return rows
    .filter((segment) => minutes(segment.from) >= at)
    .sort((left, right) => minutes(left.from) - minutes(right.from))[0] ?? null;
}

/* Tank flag for the text. A stored window that has ended leaves the heater off. */
function tankCommand(segment: DecisionSegment | null, plan: EnergyPlan, segments: DecisionSegment[]): EnergyPlan["tank"] {
  if (segment)
    return "on";
  if (plan.tank === "limited" && !segments.some((item) => item.kind === "tank"))
    return "limited";
  return "off";
}

/* Car flag for the text. No stored window leaves the car off, unless the reading itself is missing. */
function carCommand(segment: DecisionSegment | null, plan: EnergyPlan, segments: DecisionSegment[]): EnergyPlan["car"] {
  if (!segment)
    return plan.car === "limited" && !segments.some((item) => item.kind === "car") ? "limited" : "off";
  if (segment.mode === "battery")
    return "battery";
  if (segment.mode === "surplus")
    return "surplus";
  return "on";
}

/* Segments the proposal is asking for. The merge adds a wait afterwards. */
export function segmentsFromPlan(plan: EnergyPlan): DecisionSegment[] {
  const segments: DecisionSegment[] = [];
  if (plan.tank === "on" && plan.tankFrom && plan.tankTo)
    segments.push({ kind: "tank", from: plan.tankFrom, to: plan.tankTo, kw: TANK_KW, mode: "" });
  if ((plan.car === "on" || plan.car === "battery" || plan.car === "surplus") && plan.carFrom && plan.carTo) {
    const mode = plan.car === "battery" ? "battery" : plan.car === "surplus" ? "surplus" : "grid";
    segments.push({ kind: "car", from: plan.carFrom, to: plan.carTo, kw: plan.carKw, mode });
  }
  const charges = plan.battery === "grid-charge"
    ? plan.batteryCharges?.length
      ? plan.batteryCharges
      : plan.batteryFrom && plan.batteryTo
        ? [{ from: plan.batteryFrom, to: plan.batteryTo, kw: plan.batteryKw }]
        : []
    : [];
  for (const charge of charges)
    segments.push({ kind: "battery-buy", from: charge.from, to: charge.to, kw: charge.kw, mode: "" });
  if (plan.batterySellFrom && plan.batterySellTo && plan.batterySellKw > 0)
    segments.push({
      kind: "battery-sell",
      from: plan.batterySellFrom,
      to: plan.batterySellTo,
      kw: plan.batterySellKw,
      mode: ""
    });
  return segments;
}

/* Tank and car fields follow the stored decision. Battery fields stay as the charge rule left them. */
export function commandFromDecision(plan: EnergyPlan, segments: DecisionSegment[], now: string): EnergyPlan {
  const tank = coveringOrNext(segments, "tank", now);
  const car = coveringOrNext(segments, "car", now);
  const sale = coveringOrNext(segments, "battery-sell", now);
  return {
    ...plan,
    tank: tankCommand(tank, plan, segments),
    tankFrom: tank?.from ?? null,
    tankTo: tank?.to ?? null,
    car: carCommand(car, plan, segments),
    carFrom: car?.from ?? null,
    carTo: car?.to ?? null,
    carKw: car?.kw ?? 0,
    batterySellFrom: sale?.from ?? null,
    batterySellTo: sale?.to ?? null,
    batterySellKw: sale?.kw ?? 0
  };
}

/* True when a stored buy reached its end between the previous poll and this one. */
export function chargeJustEnded(stored: DecisionSegment[], previous: PlanInputs | null, now: string): boolean {
  if (!previous)
    return false;
  const then = minutes(previous.clock);
  const at = minutes(now);
  return stored.some((segment) =>
    segment.kind === "battery-buy" && minutes(segment.to) > then && minutes(segment.to) <= at
  );
}

/* One stable string so a later poll can see that today's prices moved. */
export function priceKey(prices: { periodInterval: string; eurPerMwh: number }[]): string {
  return prices.map((price) => `${price.periodInterval}=${price.eurPerMwh}`).join(",");
}

/* The first poll has no earlier inputs. Prices, the tank, and the car are the differences worth naming. */
function firstInputs(next: PlanInputs): PlanInputs {
  return {
    ...next,
    bookedChargeEnded: false,
    todayPrices: "",
    tomorrowPricesArrived: false,
    tankC: null,
    carAtHome: false,
    carMissingKwh: 0
  };
}

/* Merge, save, and append one line when the hours still ahead changed. */
export function issueTodayDecision(input: {
  archive: DecisionArchive;
  date: string;
  now: string;
  plan: EnergyPlan;
  inputs: PlanInputs;
}): EnergyPlan {
  const stored = input.archive.listDayDecisions(input.date);
  const previous = input.archive.readPlanInputs(input.date);
  const holdOpenCar = previous ? clockOnlyChange(previous, input.inputs) : false;
  const merged = settleDecision(
    stored,
    segmentsFromPlan(input.plan),
    input.now,
    input.archive.listPlanChanges(input.date),
    holdOpenCar
  );
  const line = futureChange(
    previous ? stored : [],
    merged,
    previous ?? firstInputs(input.inputs),
    input.inputs
  );
  if (line)
    input.archive.appendPlanChange(input.date, line);
  input.archive.saveDayDecisions(input.date, merged);
  input.archive.savePlanInputs(input.date, input.inputs);
  return commandFromDecision(input.plan, merged, input.now);
}

/* One segment as the day page will split it. */
function segmentText(segment: DecisionSegment): string {
  const mode = segment.mode ? ` ${segment.mode}` : "";
  return `${segment.kind} ${segment.from}-${segment.to} ${segment.kw}${mode}`;
}

/* The stored plan and the change lines, newest first. */
export function formatStoredDecision(segments: DecisionSegment[], changes: PlanChange[]): string {
  const shots = changes.map((change) => `${change.at}=${change.segments.map(segmentText).join(",")}`);
  return [
    `decisions=${segments.map(segmentText).join(";")}`,
    `planChanges=${changes.map((change) => `${change.at} ${change.trigger} | ${change.result}`).join(";")}`,
    `planSnapshots=${shots.join(";")}`,
    ""
  ].join("\n");
}
