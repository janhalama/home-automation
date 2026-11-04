/*
This module starts the Fastify API for local development.
It reuses the same application builder used by serverless deployment.
*/

import "./config/load-env.js";
import { readEnvironmentConfig } from "./config/environment.js";
import { createApp } from "./create-app.js";
import { collectHouseSnapshot, pragueTimestamp } from "./services/house-collector.js";
import { openHouseArchive } from "./services/house-archive.js";
import {
  BATTERY_POWER_STATE,
  GRID_POWER_CONTROL,
  HEATING_CONTROL,
  PV_POWER_CONTROL,
  SOC_CONTROL,
  TANK_TEMPERATURE_CONTROL,
  heatingSampleFromReadings,
  powerSampleFromReadings,
  readLoxoneControl
} from "./services/loxone-reading.js";
import type { OtePost } from "./services/ote-day-ahead.js";

const COLLECT_EVERY_MS = 15 * 60 * 1000;

/* POST one OTE request with the process fetch. */
function createOtePost(): OtePost {
  return async (url, body, headers) => {
    const response = await fetch(url, { method: "POST", body, headers });
    return {
      ok: response.ok,
      status: response.status,
      text: () => response.text()
    };
  };
}

/* Start the API and keep the price and heater archive moving. */
async function startServer(): Promise<void> {
  const app = createApp();
  const environment = readEnvironmentConfig();
  const archive = environment.houseArchivePath
    ? openHouseArchive(environment.houseArchivePath)
    : null;
  let stopped = false;
  let running = false;

  const tick = async () => {
    if (stopped || running || !archive)
      return;
    running = true;
    try {
      const loxoneConfigured = environment.loxoneHost !== "" && environment.loxoneUser !== "";
      await collectHouseSnapshot({
        archive,
        now: new Date(),
        post: createOtePost(),
        wattsonicDaysDir: environment.wattsonicDaysDir,
        readPower: loxoneConfigured
          ? async () => {
              const [pv, grid, battery, soc] = await Promise.all([
                readLoxoneControl(environment.loxoneHost, environment.loxoneUser, environment.loxonePassword, PV_POWER_CONTROL),
                readLoxoneControl(environment.loxoneHost, environment.loxoneUser, environment.loxonePassword, GRID_POWER_CONTROL),
                readLoxoneControl(environment.loxoneHost, environment.loxoneUser, environment.loxonePassword, BATTERY_POWER_STATE),
                readLoxoneControl(environment.loxoneHost, environment.loxoneUser, environment.loxonePassword, SOC_CONTROL)
              ]);
              return powerSampleFromReadings(pragueTimestamp(new Date()), pv, grid, battery, soc);
            }
          : null,
        readHeating: loxoneConfigured
          ? async () => {
              const [heating, temperature] = await Promise.all([
                readLoxoneControl(
                  environment.loxoneHost,
                  environment.loxoneUser,
                  environment.loxonePassword,
                  HEATING_CONTROL
                ),
                readLoxoneControl(
                  environment.loxoneHost,
                  environment.loxoneUser,
                  environment.loxonePassword,
                  TANK_TEMPERATURE_CONTROL
                )
              ]);
              return heatingSampleFromReadings(pragueTimestamp(new Date()), heating, temperature);
            }
          : null
      });
    } catch (error) {
      console.error(error);
    } finally {
      running = false;
    }
  };

  if (archive) {
    void tick();
    const timer = setInterval(() => void tick(), COLLECT_EVERY_MS);
    app.addHook("onClose", async () => {
      stopped = true;
      clearInterval(timer);
      archive.close();
    });
  }

  await app.listen({
    host: "0.0.0.0",
    port: Number.parseInt(process.env.PORT ?? "3000", 10)
  });
}

startServer().catch((error) => {
  console.error(error);
  process.exit(1);
});
