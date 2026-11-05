/*
Reads the heater and the boiler temperature from the Miniserver.
The tracker keeps no usable period list, so each sample is the heater output itself.
*/

import https from "node:https";
import type { HeatingSample, PowerReading } from "./house-archive.js";

export const HEATING_CONTROL = "1d571d75-02be-6f8b-ffff2666dbd01f1a";
export const TANK_TEMPERATURE_CONTROL = "1c96b4db-001f-5a4f-ffff2666dbd01f1a";
export const PV_POWER_CONTROL = "1c383f2f-00a5-8e4e-ffff2666dbd01f1a";
export const GRID_POWER_CONTROL = "1c383f2f-00b4-8e7a-ffff2666dbd01f1a";
export const BATTERY_POWER_STATE = "1c384220-01ab-745b-ffff2666dbd01f1a/all";
export const SOC_CONTROL = "1c383f2f-0095-8e12-ffff2666dbd01f1a";

/* Read the value field from a Miniserver control response. */
export function parseLoxoneValue(body: string): string {
  const parsed = JSON.parse(body) as { LL?: { value?: string; Code?: string } };
  if (parsed.LL?.Code !== "200" || parsed.LL.value === undefined)
    throw new Error("Loxone reading failed");
  return parsed.LL.value;
}

/* Build one heater sample from the two control readings. */
export function heatingSampleFromReadings(
  at: string,
  heatingBody: string,
  temperatureBody: string
): HeatingSample {
  const heating = parseLoxoneValue(heatingBody);
  if (heating !== "0" && heating !== "1")
    throw new Error("Heater state is not on or off");
  const match = parseLoxoneValue(temperatureBody).match(/-?\d+(?:[.,]\d+)?/);
  if (!match)
    throw new Error("Boiler temperature is not a number");
  return {
    at,
    heatingOn: heating === "1",
    temperatureC: Number(match[0].replace(",", "."))
  };
}

/* Read one number from a Miniserver body. A comma is a decimal mark. */
function readingNumber(body: string): number {
  const match = parseLoxoneValue(body).match(/-?\d+(?:[.,]\d+)?/);
  if (!match)
    throw new Error("Loxone reading is not a number");
  return Number(match[0].replace(",", "."));
}

/* Build one power sample from the Miniserver.
Grid power is already negative while the house imports. Battery power is already negative while it charges. */
export function powerSampleFromReadings(
  at: string,
  pvBody: string,
  gridBody: string,
  batteryBody: string,
  socBody: string
): PowerReading {
  return {
    at,
    pvKw: readingNumber(pvBody),
    meterKw: readingNumber(gridBody),
    batteryKw: readingNumber(batteryBody),
    socPercent: readingNumber(socBody)
  };
}

/* Read one Miniserver control. The Miniserver certificate is not a public one. */
export function readLoxoneControl(
  host: string,
  user: string,
  password: string,
  uuid: string
): Promise<string> {
  const authorization = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
  return new Promise((resolve, reject) => {
    const request = https.get(
      `https://${host}/jdev/sps/io/${uuid}`,
      { headers: { Authorization: authorization }, rejectUnauthorized: false },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          if (response.statusCode !== 200) {
            reject(new Error(`Loxone responded ${response.statusCode}`));
            return;
          }
          resolve(Buffer.concat(chunks).toString("utf8"));
        });
      }
    );
    request.on("error", reject);
  });
}
