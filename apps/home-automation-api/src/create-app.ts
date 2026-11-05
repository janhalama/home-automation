/*
This module builds the Fastify application instance for local and serverless use.
It wires configuration, validation, routes, and shared dependencies.
*/

import Fastify from "fastify";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { readEnvironmentConfig, type EnvironmentConfig } from "./config/environment.js";
import { formatErrorResponse } from "./lib/plain-text-response.js";
import { registerPvProductionPredictionRoute } from "./routes/pv-production-prediction.route.js";
import { createDefaultFetchImpl, type FetchImpl } from "./services/forecast-solar-client.js";
import { openPredictionStore, type PredictionStore } from "./services/prediction-store.js";
import { openHouseArchive, type HouseArchive } from "./services/house-archive.js";
import { registerEnergyDayRoute } from "./routes/energy-day.route.js";
import { registerEnergyDataRoutes } from "./routes/energy-data.route.js";
import { registerEnergyPlanRoute } from "./routes/energy-plan.route.js";
import { registerCarDayRoute } from "./routes/car-day.route.js";
import type { CarReading } from "./services/car-energy.js";
import type { CarPoint } from "./services/car-day.js";
import { readTeslaMateCar } from "./services/teslamate-car.js";
import { openCarDayQuery, readCarDay } from "./services/teslamate-history.js";

export type AppDeps = EnvironmentConfig & {
  fetchImpl: FetchImpl;
};

type CreateAppDeps = Omit<
  AppDeps,
  | "predictionDbPath"
  | "houseArchivePath"
  | "wattsonicDaysDir"
  | "loxoneHost"
  | "loxoneUser"
  | "loxonePassword"
  | "teslamateMqttHost"
  | "teslamateDatabaseHost"
  | "teslamateDatabaseUser"
  | "teslamateDatabasePassword"
  | "teslamateDatabaseName"
> & {
  predictionDbPath?: string;
  houseArchivePath?: string;
  wattsonicDaysDir?: string;
  teslamateMqttHost?: string;
  teslamateDatabaseHost?: string;
  teslamateDatabaseUser?: string;
  teslamateDatabasePassword?: string;
  teslamateDatabaseName?: string;
  readCar?: () => Promise<CarReading>;
  readCarDay?: (date: string) => Promise<CarPoint[]>;
};

/* Create application dependencies from environment variables. */
function createEnvironmentDeps(): AppDeps {
  const environment = readEnvironmentConfig();
  return {
    ...environment,
    fetchImpl: createDefaultFetchImpl()
  };
}

/* Create and configure the Fastify application instance. */
export function createApp(deps: CreateAppDeps = createEnvironmentDeps()) {
  const app = Fastify({
    ajv: {
      customOptions: {
        coerceTypes: true
      }
    }
  }).withTypeProvider<TypeBoxTypeProvider>();
  const predictionDbPath = deps.predictionDbPath ?? "";
  const predictionStore: PredictionStore | null = predictionDbPath
    ? openPredictionStore(predictionDbPath)
    : null;
  const houseArchivePath = deps.houseArchivePath ?? "";
  const houseArchive: HouseArchive | null = houseArchivePath
    ? openHouseArchive(houseArchivePath)
    : null;

  if (predictionStore)
    app.addHook("onClose", async () => {
      predictionStore.close();
    });
  if (houseArchive)
    app.addHook("onClose", async () => {
      houseArchive.close();
    });

  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/energy/"))
      return;
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Headers", "Content-Type, X-API-Key");
    reply.header("Access-Control-Allow-Methods", "GET, OPTIONS");
    if (request.method === "OPTIONS")
      return reply.status(204).send();
  });

  app.setErrorHandler((error, _request, reply) => {
    if (typeof error === "object" && error !== null && "validation" in error) {
      reply.status(400).type("text/plain; charset=utf-8").send(formatErrorResponse("bad_request"));
      return;
    }

    reply.status(500).type("text/plain; charset=utf-8").send(formatErrorResponse("internal_error"));
  });

  const forecastCache = new Map();
  const forecastClientDeps = {
    forecastSolarApiKey: deps.forecastSolarApiKey,
    timeoutMs: deps.timeoutMs,
    fetchImpl: deps.fetchImpl,
    cacheTtlSeconds: deps.cacheTtlSeconds,
    forecastCache
  };

  registerPvProductionPredictionRoute(app, {
    apiKey: deps.apiKey,
    cacheTtlSeconds: deps.cacheTtlSeconds,
    forecastClientDeps,
    predictionStore
  });

  registerEnergyDayRoute(app, {
    apiKey: deps.apiKey,
    archive: houseArchive,
    wattsonicDaysDir: deps.wattsonicDaysDir ?? "",
    predictionStore
  });

  registerEnergyDataRoutes(app, {
    apiKey: deps.apiKey,
    archive: houseArchive,
    wattsonicDaysDir: deps.wattsonicDaysDir ?? "",
    forecastClientDeps,
    predictionStore
  });

  registerEnergyPlanRoute(app, {
    apiKey: deps.apiKey,
    archive: houseArchive,
    readCar: deps.readCar ?? (deps.teslamateMqttHost
      ? () => readTeslaMateCar(deps.teslamateMqttHost ?? "")
      : null),
    fetchImpl: deps.fetchImpl
  });

  const carHistory = deps.readCarDay
    ? null
    : openCarDayQuery({
      host: deps.teslamateDatabaseHost ?? "",
      user: deps.teslamateDatabaseUser ?? "",
      password: deps.teslamateDatabasePassword ?? "",
      database: deps.teslamateDatabaseName ?? ""
    });
  if (carHistory)
    app.addHook("onClose", async () => {
      await carHistory.close();
    });
  registerCarDayRoute(app, {
    apiKey: deps.apiKey,
    readCarDay: deps.readCarDay ?? (carHistory ? (date) => readCarDay(carHistory.query, date) : null)
  });

  return app;
}
