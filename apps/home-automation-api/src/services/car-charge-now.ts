/*
The manual request to charge Obluda now.
The plan follower forces the wallbox off outside its slot, so this is the switch that opens a slot from the current quarter.
*/

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/* True when the file asks for a charge. A missing file is off. */
export function readCarChargeNow(path: string): boolean {
  try {
    const body = JSON.parse(readFileSync(path, "utf8")) as { on?: boolean };
    return body.on === true;
  } catch {
    return false;
  }
}

/* Remember the switch. The directory is created when the archive path is new. */
export function writeCarChargeNow(path: string, on: boolean): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ on })}\n`);
}
