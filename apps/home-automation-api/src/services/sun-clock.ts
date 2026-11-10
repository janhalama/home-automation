/*
Sunrise and sunset at the house, in Europe/Prague local time.
The same almanac as scripts/reduce-day-curves.py. Daylight in the plan uses these clocks.
*/

const LATITUDE = 50.6920036;
const LONGITUDE = 15.2203556;

export type SunClocks = {
  rise: string;
  set: string;
};

/* Positive remainder. JavaScript's % keeps the sign of the dividend. */
function wrap(value: number, size: number): number {
  return ((value % size) + size) % size;
}

/* Calendar date parts from YYYY-MM-DD. */
function parts(date: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match)
    throw new Error(`The sun date is missing: ${date}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/* UTC midnight for a calendar date, so weekday and day-of-year ignore the machine zone. */
function utcDate(date: string): Date {
  const { year, month, day } = parts(date);
  return new Date(Date.UTC(year, month - 1, day));
}

/* Last Sunday of a month. Europe changes the clock on that day. */
function lastSunday(year: number, month: number): string {
  const cursor = new Date(Date.UTC(year, month, 0));
  while (cursor.getUTCDay() !== 0)
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  return cursor.toISOString().slice(0, 10);
}

/* Hours to add to UTC. The spring change is already in force at sunrise. */
function pragueOffsetHours(date: string): number {
  const { year } = parts(date);
  const spring = lastSunday(year, 3);
  const autumn = lastSunday(year, 10);
  if (spring <= date && date < autumn)
    return 2;
  return 1;
}

/* Day of year, with 1 January as 1. Leap days count. */
function dayOfYear(date: string): number {
  const start = Date.UTC(parts(date).year, 0, 1);
  return Math.floor((utcDate(date).getTime() - start) / 86_400_000) + 1;
}

/* HH:MM:SS from a fractional hour. */
function clock(hours: number): string {
  const wrapped = wrap(hours, 24);
  let hour = Math.floor(wrapped);
  let minute = Math.round((wrapped - hour) * 60);
  if (minute === 60) {
    hour = (hour + 1) % 24;
    minute = 0;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}

/* Sunrise and sunset as local clock strings. */
export function sunClocks(date: string): SunClocks {
  const ordinal = dayOfYear(date);
  const longitudeHours = LONGITUDE / 15;

  function utcHours(t: number, rising: boolean): number {
    const mean = (0.9856 * t) - 3.289;
    const ecliptic = wrap(mean + 1.916 * Math.sin(mean * Math.PI / 180) + 0.020 * Math.sin(2 * mean * Math.PI / 180) + 282.634, 360);
    let rightAscension = wrap(Math.atan(0.91764 * Math.tan(ecliptic * Math.PI / 180)) * 180 / Math.PI, 360);
    rightAscension += Math.floor(ecliptic / 90) * 90 - Math.floor(rightAscension / 90) * 90;
    rightAscension /= 15;
    const sinDeclination = 0.39782 * Math.sin(ecliptic * Math.PI / 180);
    const cosDeclination = Math.cos(Math.asin(sinDeclination));
    const cosHour = Math.max(-1, Math.min(1,
      (Math.cos(90.833 * Math.PI / 180) - sinDeclination * Math.sin(LATITUDE * Math.PI / 180))
      / (cosDeclination * Math.cos(LATITUDE * Math.PI / 180))
    ));
    const hourAngle = (rising ? 360 - Math.acos(cosHour) * 180 / Math.PI : Math.acos(cosHour) * 180 / Math.PI) / 15;
    return wrap(hourAngle + rightAscension - (0.06571 * t) - 6.622 - longitudeHours, 24);
  }

  const offset = pragueOffsetHours(date);
  return {
    rise: clock(utcHours(ordinal + (6 - longitudeHours) / 24, true) + offset),
    set: clock(utcHours(ordinal + (18 - longitudeHours) / 24, false) + offset)
  };
}

/* Add whole calendar days. */
export function addDays(date: string, days: number): string {
  const next = utcDate(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

/* Monday is 1 and Sunday is 0, for the calendar date. */
export function weekday(date: string): number {
  return utcDate(date).getUTCDay();
}

/* The daylight the reserve covers. After sunset, that daylight is tomorrow. */
export function daylightDate(planDate: string, startAt: string | null): string {
  if (!startAt)
    return planDate;
  const set = sunClocks(planDate).set.slice(0, 5);
  if (startAt >= set)
    return addDays(planDate, 1);
  return planDate;
}
