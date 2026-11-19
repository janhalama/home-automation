/*
The battery row on the day chart.
Charge sits below zero. When the plan carries the stored charge list, that
list is the green block, including a window that has already ended. Without
the list, a past quarter keeps the sunrise plan and a later quarter uses the
live plan.
*/

export type BatteryPlanWindow = {
  batteryFrom: string | null;
  batteryTo: string | null;
  batteryKw: number;
  batterySellFrom: string | null;
  batterySellTo: string | null;
  batterySellKw: number;
  batteryDischargeFrom?: string | null;
  batteryDischargeTo?: string | null;
  batteryDischargeKw?: number;
  tankFrom?: string | null;
  tankTo?: string | null;
  carFrom?: string | null;
  carTo?: string | null;
  carKw?: number;
  batteryCharges?: { from: string; to: string; kw: number }[];
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

/* The stored charge that covers this quarter, when the plan carries the list. */
function loggedCharge(plan: BatteryPlanWindow | null, time: string): { from: string; to: string; kw: number } | null {
  if (!plan?.batteryCharges)
    return null;
  return plan.batteryCharges.find((window) => inSlot(time, window.from, window.to)) ?? null;
}

/* Charge power from the stored list. The car and the tank still cut only their own minutes. */
function loggedChargeKw(plan: BatteryPlanWindow, time: string): number | null {
  const hit = loggedCharge(plan, time);
  if (!hit)
    return null;
  return -chargeKw({ ...plan, batteryKw: hit.kw, batteryFrom: hit.from, batteryTo: hit.to }, time);
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

export type BatteryPlanParts = {
  buy: number | null;
  house: number | null;
  sale: number | null;
};

export type BatteryMeasuredParts = {
  buy: number | null;
  sun: number | null;
  house: number | null;
  sale: number | null;
};

/* Grid share of a charge. The panels cover it first. A buy cannot exceed the import. Without a panel reading the import covers the charge and the rest stays the sun. */
function chargeFromGrid(charge: number, meterKw: number | null, pvKw: number | null): number {
  const importing = meterKw === null ? charge : Math.max(0, -meterKw);
  if (pvKw === null)
    return Math.min(charge, importing);
  const exporting = meterKw !== null && meterKw > 0 ? meterKw : 0;
  const fromPanels = Math.min(charge, Math.max(0, pvKw - exporting));
  return Math.min(importing, charge - fromPanels);
}

/* Share of a discharge that left through the meter during a planned sale. The rest stayed in the house. */
function soldKw(discharge: number, meterKw: number | null, plannedSale: boolean): number {
  if (!plannedSale)
    return 0;
  if (meterKw === null)
    return discharge;
  return Math.min(discharge, Math.max(0, meterKw));
}

/* Charge below zero splits into a grid buy and the sun. Discharge above zero is a sale or the house. */
export function batteryMeasuredParts(
  batteryKw: number | null,
  meterKw: number | null,
  plannedSale: boolean,
  pvKw: number | null = null
): BatteryMeasuredParts {
  if (batteryKw === null)
    return { buy: null, sun: null, house: null, sale: null };
  if (batteryKw < 0) {
    const charge = -batteryKw;
    const fromGrid = chargeFromGrid(charge, meterKw, pvKw);
    const fromSun = charge - fromGrid;
    return { buy: fromGrid === 0 ? 0 : -fromGrid, sun: fromSun === 0 ? 0 : -fromSun, house: 0, sale: 0 };
  }
  if (batteryKw > 0) {
    const sold = soldKw(batteryKw, meterKw, plannedSale);
    const house = batteryKw - sold;
    return { buy: 0, sun: 0, house: house === 0 ? 0 : house, sale: sold === 0 ? 0 : sold };
  }
  return { buy: 0, sun: 0, house: batteryKw, sale: 0 };
}

/* Buy and sale for one quarter. The plan does not schedule house consumption. */
export function batteryPlanParts(
  time: string,
  live: BatteryPlanWindow | null,
  opening: BatteryPlanWindow | null,
  recordedUntilMinute: number | null
): BatteryPlanParts {
  const plan = planForQuarter(time, live, opening, recordedUntilMinute);
  const empty = { buy: null, house: null, sale: null };
  if (live?.batteryCharges) {
    const buy = loggedChargeKw(live, time) ?? 0;
    const selling = Boolean(plan && inSlot(time, plan.batterySellFrom, plan.batterySellTo));
    return {
      buy,
      house: 0,
      sale: selling ? plan?.batterySellKw ?? 0 : 0
    };
  }
  if (!plan)
    return empty;
  const kw = plannedKw(plan, time);
  const selling = inSlot(time, plan.batterySellFrom, plan.batterySellTo);
  if (kw === null)
    return empty;
  return {
    buy: kw < 0 ? kw : 0,
    house: 0,
    sale: kw > 0 ? kw : 0
  };
}

/* kW the battery plan row draws for this quarter. */
export function batteryPlanKw(
  time: string,
  live: BatteryPlanWindow | null,
  opening: BatteryPlanWindow | null,
  recordedUntilMinute: number | null
): number | null {
  if (live?.batteryCharges)
    return loggedChargeKw(live, time) ?? 0;
  return plannedKw(planForQuarter(time, live, opening, recordedUntilMinute), time);
}

/* Slots the row draws. A stored charge list replaces the sunrise charge. Sales stay on the merged plan. */
function shownSlots(
  live: BatteryPlanWindow | null,
  opening: BatteryPlanWindow | null,
  recordedUntilMinute: number | null
): NamedSlot[] {
  const merged = recordedUntilMinute === null
    ? namedSlots(opening ?? live)
    : [
      ...namedSlots(opening).filter((slot) => overlaps(slot.from, slot.to, 0, recordedUntilMinute)),
      ...namedSlots(live).filter((slot) => overlaps(slot.from, slot.to, recordedUntilMinute, 24 * 60))
    ];
  const slots = live?.batteryCharges
    ? [
      ...live.batteryCharges.map((window) => ({
        label: `charge ${window.from}–${window.to}`,
        from: window.from,
        to: window.to,
        kind: "charge" as const,
        kw: window.kw
      })),
      ...merged.filter((slot) => slot.kind === "sale")
    ]
    : merged;
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
