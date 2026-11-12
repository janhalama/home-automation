/*
The battery row on the day chart.
Charge sits below zero. A quarter that has already passed uses the plan from
the state of charge at the start of the day, so a night charge stays on the
chart after the battery is full. A quarter still ahead uses the live plan.
*/

export type BatteryPlanWindow = {
  batteryFrom: string | null;
  batteryTo: string | null;
  batteryKw: number;
  batterySellFrom: string | null;
  batterySellTo: string | null;
  batterySellKw: number;
  tankFrom?: string | null;
  tankTo?: string | null;
  carFrom?: string | null;
  carTo?: string | null;
  carKw?: number;
};

const BREAKER_KW = 17;
const HOUSE_KW = 1;
const TANK_KW = 2.5;

/* Charge power for this quarter. The plan's kW is the ceiling. The car, and the tank with it, only cut the minutes they are actually on. */
function chargeKw(plan: BatteryPlanWindow, time: string): number {
  const tankOn = inSlot(time, plan.tankFrom ?? null, plan.tankTo ?? null);
  const carOn = inSlot(time, plan.carFrom ?? null, plan.carTo ?? null);
  const taken = HOUSE_KW + (tankOn ? TANK_KW : 0) + (carOn ? plan.carKw ?? 0 : 0);
  const room = BREAKER_KW - taken;
  if (room <= 0)
    return 0;
  return Math.min(plan.batteryKw, room);
}

type NamedSlot = {
  label: string;
  from: string;
  to: string;
  kind: "charge" | "sale";
  kw: number;
};

/* Clock HH:MM to minutes after midnight. */
function minutes(clock: string): number {
  const [hour, minute] = clock.split(":");
  return Number(hour) * 60 + Number(minute);
}

/* True when this quarter sits inside the plan. A slot that passes midnight includes both ends. */
function inSlot(time: string, from: string | null, to: string | null): boolean {
  if (!from || !to)
    return false;
  const at = minutes(time);
  const start = minutes(from);
  const end = minutes(to);
  if (start === end)
    return false;
  if (end > start)
    return at >= start && at < end;
  return at >= start || at < end;
}

/* True when the slot shares any minute with [fromMin, toMin). */
function overlaps(from: string, to: string, fromMin: number, toMin: number): boolean {
  const start = minutes(from);
  const end = minutes(to);
  if (start === end)
    return false;
  if (end > start)
    return start < toMin && end > fromMin;
  return overlaps(from, "24:00", fromMin, toMin) || overlaps("00:00", to, fromMin, toMin);
}

/* Sale and charge labels this plan books. */
function namedSlots(plan: BatteryPlanWindow | null): NamedSlot[] {
  if (!plan)
    return [];
  const slots: NamedSlot[] = [];
  if (plan.batterySellFrom && plan.batterySellTo)
    slots.push({
      label: `sale ${plan.batterySellFrom}–${plan.batterySellTo}`,
      from: plan.batterySellFrom,
      to: plan.batterySellTo,
      kind: "sale",
      kw: plan.batterySellKw
    });
  if (plan.batteryFrom && plan.batteryTo)
    slots.push({
      label: `charge ${plan.batteryFrom}–${plan.batteryTo}`,
      from: plan.batteryFrom,
      to: plan.batteryTo,
      kind: "charge",
      kw: plan.batteryKw
    });
  return slots;
}

/* kW for one quarter. Empty when that plan has no battery hours. */
function plannedKw(plan: BatteryPlanWindow | null, time: string): number | null {
  if (!plan)
    return null;
  if (inSlot(time, plan.batteryFrom, plan.batteryTo))
    return -chargeKw(plan, time);
  if (inSlot(time, plan.batterySellFrom, plan.batterySellTo))
    return plan.batterySellKw;
  if (!plan.batteryFrom && !plan.batterySellFrom)
    return null;
  return 0;
}

/* The plan that explains this quarter. Past quarters keep the morning decision. */
function planForQuarter(
  time: string,
  live: BatteryPlanWindow | null,
  opening: BatteryPlanWindow | null,
  recordedUntilMinute: number | null
): BatteryPlanWindow | null {
  if (recordedUntilMinute === null)
    return opening ?? live;
  if (minutes(time) < recordedUntilMinute)
    return opening ?? live;
  return live;
}

/* kW the battery plan row draws for this quarter. */
export function batteryPlanKw(
  time: string,
  live: BatteryPlanWindow | null,
  opening: BatteryPlanWindow | null,
  recordedUntilMinute: number | null
): number | null {
  return plannedKw(planForQuarter(time, live, opening, recordedUntilMinute), time);
}

/* Slots the row draws. Past hours come from the morning plan. Later hours come from the live plan. */
function shownSlots(
  live: BatteryPlanWindow | null,
  opening: BatteryPlanWindow | null,
  recordedUntilMinute: number | null
): NamedSlot[] {
  const slots = recordedUntilMinute === null
    ? namedSlots(opening ?? live)
    : [
      ...namedSlots(opening).filter((slot) => overlaps(slot.from, slot.to, 0, recordedUntilMinute)),
      ...namedSlots(live).filter((slot) => overlaps(slot.from, slot.to, recordedUntilMinute, 24 * 60))
    ];
  return slots.filter((slot, index) => slots.findIndex((other) => other.label === slot.label) === index);
}

/* Title for the slots the row actually draws. */
export function batteryPlanTitle(
  live: BatteryPlanWindow | null,
  opening: BatteryPlanWindow | null,
  recordedUntilMinute: number | null
): string {
  const labels = shownSlots(live, opening, recordedUntilMinute).map((slot) => slot.label);
  if (labels.length === 0)
    return "Battery plan off";
  return `Battery plan, ${labels.join(", ")}`;
}

/* Charge clause for the sentence under the charts. Same hours as the battery row. */
export function batteryChargeSentence(
  live: BatteryPlanWindow | null,
  opening: BatteryPlanWindow | null,
  recordedUntilMinute: number | null
): string {
  const charges = shownSlots(live, opening, recordedUntilMinute).filter((slot) => slot.kind === "charge");
  if (charges.length === 0)
    return "Battery charge off";
  return charges.map((slot) => `Battery charge ${slot.from}–${slot.to} at ${slot.kw.toFixed(1)} kW`).join(". ");
}
