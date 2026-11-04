/*
Obluda's missing energy, from the usable charge and the charge limit TeslaMate publishes.
The pack is this Model Y, 75 kWh. The API does not send a command to the car.
*/

export const CAR_PACK_KWH = 75;

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

/* The car job the plan uses, from one TeslaMate reading. */
export function carJobFromReading(reading: CarReading): { missingKwh: number; pluggedIn: boolean; atHome: boolean } {
  return {
    missingKwh: missingCarKwh(reading.usablePercent, reading.limitPercent),
    pluggedIn: reading.pluggedIn,
    atHome: reading.atHome
  };
}
