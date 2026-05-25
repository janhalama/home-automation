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

export type AppDeps = EnvironmentConfig & {
  fetchImpl: FetchImpl;
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
export function createApp(deps: AppDeps = createEnvironmentDeps()) {
  const app = Fastify({
    ajv: {
      customOptions: {
        coerceTypes: true
      }
    }
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.setErrorHandler((error, _request, reply) => {
    if (typeof error === "object" && error !== null && "validation" in error) {
      reply.status(400).type("text/plain; charset=utf-8").send(formatErrorResponse("bad_request"));
      return;
    }

    reply.status(500).type("text/plain; charset=utf-8").send(formatErrorResponse("internal_error"));
  });

  registerPvProductionPredictionRoute(app, {
    apiKey: deps.apiKey,
    cacheTtlSeconds: deps.cacheTtlSeconds,
    forecastClientDeps: {
      forecastSolarApiKey: deps.forecastSolarApiKey,
      timeoutMs: deps.timeoutMs,
      fetchImpl: deps.fetchImpl
    }
  });

  return app;
}
