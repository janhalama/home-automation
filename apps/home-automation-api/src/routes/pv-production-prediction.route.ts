/*
This module registers the scoped PV production prediction route.
It validates query input, applies auth checks, maps service errors, and returns text.
*/

import { Type } from "@fastify/type-provider-typebox";
import type { FastifyInstance } from "fastify";
import { formatErrorResponse, formatPredictionResponse } from "../lib/plain-text-response.js";
import {
  isForecastClientError,
  type ForecastClientDeps
} from "../services/forecast-solar-client.js";
import {
  aggregatePvPrediction,
  type PvPredictionQuery
} from "../services/pv-production-aggregator.js";

export type RouteDeps = {
  apiKey: string;
  cacheTtlSeconds: number;
  forecastClientDeps: ForecastClientDeps;
};

const querySchema = Type.Object(
  {
    lat: Type.Number(),
    lon: Type.Number(),
    slope: Type.Number(),
    eastAzimuth: Type.Number(),
    eastKwp: Type.Number(),
    westAzimuth: Type.Number(),
    westKwp: Type.Number(),
    apiKey: Type.Optional(Type.String())
  },
  { additionalProperties: false }
);

/* Validate request auth key from header with query fallback. */
function isAuthorized(
  routeApiKey: string,
  headerApiKey: string | undefined,
  queryApiKey: string | undefined
): boolean {
  return (headerApiKey ?? queryApiKey) === routeApiKey;
}

/* Map client errors to HTTP status and text codes. */
function mapClientError(errorCode: string): { statusCode: number; errorCode: string } {
  if (errorCode === "timeout")
    return { statusCode: 504, errorCode: "upstream_timeout" };
  if (errorCode === "upstream_unavailable")
    return { statusCode: 503, errorCode: "upstream_unavailable" };
  if (errorCode === "upstream_rate_limited")
    return { statusCode: 503, errorCode: "upstream_rate_limited" };
  if (errorCode === "upstream_unauthorized")
    return { statusCode: 502, errorCode: "upstream_unauthorized" };
  return { statusCode: 502, errorCode: "upstream_invalid_payload" };
}

/* Register route handlers for PV prediction success and method errors. */
export function registerPvProductionPredictionRoute(
  app: FastifyInstance,
  deps: RouteDeps
): void {
  app.route({
    method: "GET",
    url: "/api/pv/production-prediction",
    schema: {
      querystring: querySchema
    },
    handler: async (request, reply) => {
      const query = request.query as PvPredictionQuery & { apiKey?: string };
      const headerApiKey = request.headers["x-api-key"];
      const queryApiKey = typeof query.apiKey === "string" ? query.apiKey : undefined;

      if (
        !isAuthorized(
          deps.apiKey,
          typeof headerApiKey === "string" ? headerApiKey : undefined,
          queryApiKey
        )
      ) {
        reply
          .status(401)
          .type("text/plain; charset=utf-8")
          .send(formatErrorResponse("unauthorized"));
        return;
      }

      try {
        const prediction = await aggregatePvPrediction(query, deps.forecastClientDeps);
        reply
          .status(200)
          .type("text/plain; charset=utf-8")
          .header(
            "Cache-Control",
            `s-maxage=${deps.cacheTtlSeconds}, stale-while-revalidate=${deps.cacheTtlSeconds * 6}`
          )
          .send(formatPredictionResponse(prediction.todayKwh, prediction.tomorrowKwh));
        return;
      } catch (error) {
        if (isForecastClientError(error)) {
          const mapped = mapClientError(error.code);
          reply
            .status(mapped.statusCode)
            .type("text/plain; charset=utf-8")
            .send(formatErrorResponse(mapped.errorCode));
          return;
        }

        reply.status(502).type("text/plain; charset=utf-8").send(formatErrorResponse("upstream_error"));
      }
    }
  });

  app.route({
    method: ["POST", "PUT", "PATCH", "DELETE"],
    url: "/api/pv/production-prediction",
    handler: async (_request, reply) => {
      reply.status(405).type("text/plain; charset=utf-8").send(formatErrorResponse("method_not_allowed"));
    }
  });
}
