/*
One-time Tesla Fleet charge schedule bodies for the house wallbox.
Times are minutes after midnight. 24:00 is sent as minute 0.
*/

export const HOUSE_SCHEDULE_ID = 1;

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
