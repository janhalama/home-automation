/*
This test suite verifies the scoped PV production prediction endpoint contract.
It checks auth, query validation, success formatting, and upstream error mapping.
*/

import { describe, expect, it } from "vitest";
import { createApp } from "../src/create-app.js";

function createQueryString(): string {
  return [
    "lat=50.6920036",
    "lon=15.2203556",
    "slope=45",
    "eastAzimuth=-63",
    "eastKwp=5.5",
    "westAzimuth=113",
    "westKwp=4.5"
  ].join("&");
}

describe("GET /api/pv/production-prediction", () => {
  it("returns 503 when server API key is not configured", async () => {
    const app = createApp({
      apiKey: "",
      cacheTtlSeconds: 3600,
      timeoutMs: 8000,
      forecastSolarApiKey: "",
      fetchImpl: async () => {
        throw new Error("fetch should not be called");
      }
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/pv/production-prediction?${createQueryString()}`,
      headers: {
        "x-api-key": "secret-key"
      }
    });

    expect(response.statusCode).toBe(503);
    expect(response.body).toContain("error=server_misconfigured");
  });

  it("returns 401 when API key is missing", async () => {
    const app = createApp({
      apiKey: "secret-key",
      cacheTtlSeconds: 3600,
      timeoutMs: 8000,
      forecastSolarApiKey: "",
      fetchImpl: async () => {
        throw new Error("fetch should not be called");
      }
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/pv/production-prediction?${createQueryString()}`
    });

    expect(response.statusCode).toBe(401);
    expect(response.body).toContain("error=unauthorized");
  });

  it("returns 400 when a required query parameter is missing", async () => {
    const app = createApp({
      apiKey: "secret-key",
      cacheTtlSeconds: 3600,
      timeoutMs: 8000,
      forecastSolarApiKey: "",
      fetchImpl: async () => {
        throw new Error("fetch should not be called");
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/pv/production-prediction?lat=50.6920036"
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns aggregated plain text values on success", async () => {
    const app = createApp({
      apiKey: "secret-key",
      cacheTtlSeconds: 3600,
      timeoutMs: 8000,
      forecastSolarApiKey: "",
      fetchImpl: async (url) => {
        const endpoint = String(url);
        const east = endpoint.includes("/-63/5.5");
        const payload = east
          ? {
              result: {
                watt_hours_day: {
                  "2026-05-25": 10000,
                  "2026-05-26": 12000
                }
              }
            }
          : {
              result: {
                watt_hours_day: {
                  "2026-05-25": 3000,
                  "2026-05-26": 5000
                }
              }
            };

        return new Response(JSON.stringify(payload), { status: 200 });
      }
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/pv/production-prediction?${createQueryString()}`,
      headers: {
        "x-api-key": "secret-key"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.body).toContain("today=13.000");
    expect(response.body).toContain("tomorrow=17.000");
  });

  it("maps upstream 503 to 503", async () => {
    const app = createApp({
      apiKey: "secret-key",
      cacheTtlSeconds: 3600,
      timeoutMs: 8000,
      forecastSolarApiKey: "",
      fetchImpl: async () => new Response("unavailable", { status: 503 })
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/pv/production-prediction?${createQueryString()}`,
      headers: {
        "x-api-key": "secret-key"
      }
    });

    expect(response.statusCode).toBe(503);
  });

  it("maps malformed upstream payloads to 502", async () => {
    const app = createApp({
      apiKey: "secret-key",
      cacheTtlSeconds: 3600,
      timeoutMs: 8000,
      forecastSolarApiKey: "",
      fetchImpl: async () => new Response(JSON.stringify({ bad: true }), { status: 200 })
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/pv/production-prediction?${createQueryString()}`,
      headers: {
        "x-api-key": "secret-key"
      }
    });

    expect(response.statusCode).toBe(502);
  });
});
