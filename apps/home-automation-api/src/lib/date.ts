/*
This module provides date-key helpers used for forecast.solar day lookups.
It centralizes date formatting so services use consistent day boundaries.
*/

export type DatePair = {
  todayKey: string;
  tomorrowKey: string;
};

/* Format a Date object to YYYY-MM-DD in UTC. */
function formatDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/* Build current and next-day keys for upstream daily forecast maps. */
export function createDatePair(referenceDate: Date = new Date()): DatePair {
  const today = new Date(referenceDate);
  const tomorrow = new Date(referenceDate);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  return {
    todayKey: formatDateKey(today),
    tomorrowKey: formatDateKey(tomorrow)
  };
}
