/*
Obluda's missing energy, from the usable charge and the charge limit TeslaMate publishes.
The pack is this Model Y, 75 kWh. The API does not send a command to the car.
*/

export const CAR_PACK_KWH = 75;
export const MORNING_CAR_PERCENT = 35;

/* Kilowatt-hours still needed to reach the car's own charge limit. */
export function missingCarKwh(usablePercent: number, limitPercent: number): number {
  if (
    usablePercent < 0 || usablePercent > 100 ||
    limitPercent < 0 || limitPercent > 100
  )
    throw new Error("Car charge is not a percentage");
  return Math.max(0, limitPercent - usablePercent) / 100 * CAR_PACK_KWH;
}

export type CarReading = {
  usablePercent: number;
  limitPercent: number;
  pluggedIn: boolean;
  atHome: boolean;
};

/* Kilowatt-hours the morning must reach, and the rest up to the car's own limit. */
export function morningCarKwh(usablePercent: number, missingKwh: number): { floorKwh: number; limitKwh: number } {
  const toFloor = Math.max(0, MORNING_CAR_PERCENT - usablePercent) / 100 * CAR_PACK_KWH;
  return { floorKwh: Math.min(missingKwh, toFloor), limitKwh: missingKwh };
}

/* The car job the plan uses, from one TeslaMate reading. */
export function carJobFromReading(reading: CarReading): {
  missingKwh: number;
  usablePercent: number;
  pluggedIn: boolean;
  atHome: boolean;
} {
  return {
    missingKwh: missingCarKwh(reading.usablePercent, reading.limitPercent),
    usablePercent: reading.usablePercent,
    pluggedIn: reading.pluggedIn,
    atHome: reading.atHome
  };
}
