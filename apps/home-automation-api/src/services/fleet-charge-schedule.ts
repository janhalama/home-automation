/*
One-time Tesla Fleet charge schedule bodies and the proxy command that posts them.
Times are minutes after midnight. 24:00 is sent as minute 0.
*/

import type { CarSchedule, CarScheduleAction } from "./car-schedule.js";

export const HOUSE_SCHEDULE_ID = 1;

type ScheduleWrite = Exclude<CarScheduleAction, { action: "keep" }>;

type CommandFetch = (url: string, init?: RequestInit) => Promise<Response>;

export type ChargeScheduleWindow = {
  date: string;
  from: string;
  to: string;
  lat: number;
  lon: number;
};

/* Clock HH:MM to minutes after midnight. 24:00 is minute 0. */
function minutesAfterMidnight(clock: string): number {
  const [hourText, minuteText] = clock.split(":");
  const total = Number(hourText) * 60 + Number(minuteText);
  if (total === 24 * 60)
    return 0;
  return total;
}

/* English weekday of the plan date in Europe/Prague. */
function weekdayInPrague(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Prague",
    weekday: "long"
  }).format(new Date(`${date}T12:00:00Z`));
}

/* Body for Tesla add_charge_schedule. One-time, always schedule 1. */
export function addChargeScheduleBody(window: ChargeScheduleWindow) {
  return {
    id: HOUSE_SCHEDULE_ID,
    enabled: true,
    one_time: true,
    days_of_week: weekdayInPrague(window.date),
    start_enabled: true,
    start_time: minutesAfterMidnight(window.from),
    end_enabled: true,
    end_time: minutesAfterMidnight(window.to),
    lat: window.lat,
    lon: window.lon
  };
}

/* Body for Tesla remove_charge_schedule. Always schedule 1. */
export function removeChargeScheduleBody() {
  return { id: HOUSE_SCHEDULE_ID };
}

/* True when the proxy answered 200 and response.result is true. */
async function commandWasAccepted(response: Response): Promise<boolean> {
  if (response.status !== 200)
    return false;
  try {
    const body = await response.json() as { response?: { result?: unknown } };
    return body.response?.result === true;
  } catch {
    return false;
  }
}

/* Post add or remove. A rejected, thrown, or unreadable command returns null. */
export async function sendCarSchedule(input: {
  proxyUrl: string;
  vin: string;
  action: ScheduleWrite;
  date: string;
  lat: number;
  lon: number;
  fetchImpl?: CommandFetch;
}): Promise<CarSchedule | null> {
  const command = input.action.action === "add" ? "add_charge_schedule" : "remove_charge_schedule";
  const body = input.action.action === "add"
    ? addChargeScheduleBody({
      date: input.date,
      from: input.action.slot.from,
      to: input.action.slot.to,
      lat: input.lat,
      lon: input.lon
    })
    : removeChargeScheduleBody();
  try {
    const response = await (input.fetchImpl ?? fetch)(
      `${input.proxyUrl}/api/1/vehicles/${input.vin}/command/${command}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      }
    );
    if (!await commandWasAccepted(response))
      return null;
    if (input.action.action === "add")
      return { id: HOUSE_SCHEDULE_ID, from: input.action.slot.from, to: input.action.slot.to };
    return { id: HOUSE_SCHEDULE_ID, from: "", to: "" };
  } catch {
    return null;
  }
}
