/*
This module formats successful and error route responses as plain text.
It keeps the Loxone-facing response contract explicit and stable.
*/

/* Format a numeric kWh value with fixed precision. */
function formatKwh(value: number): string {
  return value.toFixed(3);
}

/* Format the successful PV prediction response body. */
export function formatPredictionResponse(todayKwh: number, tomorrowKwh: number): string {
  return `today=${formatKwh(todayKwh)}\ntomorrow=${formatKwh(tomorrowKwh)}\n`;
}

/* Format a minimal plain-text error body. */
export function formatErrorResponse(errorCode: string): string {
  return `error=${errorCode}\n`;
}
