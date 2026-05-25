# Home Automation API PV Endpoint Research

This document researches a replacement for the current Loxone PV production prediction flow. The proposed approach removes JSON parsing from the Loxone C script and moves forecast.solar integration, response validation, and panel aggregation into a Fastify service deployed to Vercel, protected by a pre-shared API key.

## Current State

The current `src/loxone/pv-production-prediction.c` script calls forecast.solar directly from Loxone for the east and west panel orientations. It then strips HTTP headers, parses forecast.solar JSON through `src/lib/nx_json.c`, extracts date-keyed values, sums both orientations, updates the block outputs, and writes the same values into Loxone virtual inputs.

This makes the Loxone script responsible for too much:

- Building forecast.solar URLs.
- Handling upstream JSON.
- Bundling and maintaining a custom JSON parser for the PicoC/Loxone environment.
- Aggregating multiple panel orientations.
- Keeping unit conversion consistent between parser code and the Loxone block.

The generated bundle is much larger than the business logic because it includes `picoc.h`, `nx_json.h`, `nx_json.c`, `forecast_solar.h`, `forecast_solar.c`, and the Loxone script. Removing JSON parsing should make the Loxone side easier to inspect, test, and upload.

## Recommended Approach

Deploy a small Fastify service (`home-automation-api`) on Vercel that exposes a scoped PV endpoint:

```text
GET /api/pv/production-prediction?lat=50.6920036&lon=15.2203556&slope=45&eastAzimuth=-63&eastKwp=5.5&westAzimuth=113&westKwp=4.5
X-API-Key: <pre-shared-key>
```

On success, return `200 OK` with a plain-text body:

```text
today=12.34
tomorrow=23.45
```

The response values should be total predicted production in kWh across all configured panel orientations. The Loxone C script should only check the HTTP status code and parse named numeric values line by line.

This approach keeps the Loxone block simple and makes the Vercel service the owner of API-specific behavior. It is also the most flexible option if the forecast provider, panel layout, rounding, caching, or diagnostics need to change later.

## API Contract

### Request

Use `GET` because the endpoint is read-only and cacheable.

Required authentication:

```text
X-API-Key: <pre-shared-key>
```

Recommended query parameters:

```text
lat=<decimal latitude>
lon=<decimal longitude>
slope=<panel declination degrees>
eastAzimuth=<degrees>
eastKwp=<installed kWp>
westAzimuth=<degrees>
westKwp=<installed kWp>
```

The first version should support the full set of panel configuration query parameters from day one instead of storing PV geometry in service configuration. This keeps the endpoint reusable across multiple installations and avoids tying route behavior to deployment-time constants.

Recommended request:

```text
GET /api/pv/production-prediction?lat=50.6920036&lon=15.2203556&slope=45&eastAzimuth=-63&eastKwp=5.5&westAzimuth=113&westKwp=4.5
X-API-Key: <pre-shared-key>
```

### Successful Response

```text
HTTP/1.1 200 OK
Content-Type: text/plain; charset=utf-8
Cache-Control: s-maxage=3600, stale-while-revalidate=21600

today=12.34
tomorrow=23.45
```

Rules:

- `today` and `tomorrow` are decimal kWh values.
- Dot is always the decimal separator.
- Each value is on its own line as `name=value`.
- Unknown lines can be ignored by the C parser to allow future additions.
- The response should not include JSON, comments, quoted strings, or nested structures.

### Error Responses

HTTP status should determine whether retrieval was successful. The response body can remain plain text for debugging, but the Loxone script should not depend on error-body parsing.

Recommended statuses:

- `200 OK`: prediction returned successfully.
- `400 Bad Request`: missing or invalid request parameters if the API accepts query configuration.
- `401 Unauthorized`: missing or wrong pre-shared API key.
- `405 Method Not Allowed`: non-GET request.
- `429 Too Many Requests`: optional service-side rate limit.
- `502 Bad Gateway`: forecast.solar returned malformed data or an unexpected successful payload.
- `503 Service Unavailable`: forecast.solar is unavailable, overloaded, or returns maintenance status.
- `504 Gateway Timeout`: upstream forecast.solar request timed out.

Example error body:

```text
error=unauthorized
```

## Vercel Service Design

Use Fastify as the API framework and deploy it as a single Vercel Function. The implementation should return plain text with explicit status and headers:

```ts
return new Response("today=12.34\ntomorrow=23.45\n", {
  status: 200,
  headers: {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "s-maxage=3600, stale-while-revalidate=21600",
  },
});
```

Core behavior:

1. Reject non-GET methods with `405`.
2. Compare `X-API-Key` against `HOME_AUTOMATION_API_KEY`.
3. Validate all required query parameters.
4. Build two forecast.solar `estimate/watthours/day` requests, one per orientation.
5. Fetch both orientations with a timeout.
6. Extract `result.watt_hours_day` for today and tomorrow.
7. Sum both orientations.
8. Convert Wh to kWh once.
9. Return the named plain-text response.

Forecast.solar's documented daily estimate endpoint returns date-keyed day totals under `result.watt_hours_day`. It also documents standard error codes including `400`, `401`, `403`, and `503`, which map cleanly into the proposed service statuses.

## C Script Design

The Loxone C script should stop calling forecast.solar directly. It should call only the home automation API service:

```text
SERVER_ADDRESS "<vercel-domain>"
URL_PATH "/api/pv/production-prediction"
```

The script should:

- Call `httpget()` once.
- Determine whether the HTTP response is successful before parsing the body.
- Use the existing header-skipping helper or a smaller replacement.
- Parse only `today=<float>` and `tomorrow=<float>` lines.
- Update outputs and virtual inputs only when both values are present.
- Preserve the previous output values when retrieval fails.
- Write a compact debug message with status and reason.

The parser can be implemented with simple string scanning:

```text
today=12.34
tomorrow=23.45
```

No JSON parser, tree structure, dynamic JSON nodes, or date-key lookup is needed.

## Alternatives Considered

### Alternative 1: Return Bare Positional Values

Example:

```text
12.34
23.45
```

This is the easiest format to parse, but it is fragile. If a line is missing or a future value is added, the C script can silently assign the wrong meaning. It is not recommended.

### Alternative 2: Return Named Plain Text Values

Example:

```text
today=12.34
tomorrow=23.45
```

This is the recommended format. It stays simple for PicoC, avoids JSON, and remains self-describing. The C parser can ignore unknown lines and require the two known keys.

### Alternative 3: Return CSV

Example:

```text
date,value
2026-05-24,12.34
2026-05-25,23.45
```

CSV is useful for tabular data, but it reintroduces date handling and header parsing into the C script. It is more general than needed for a two-value control input and is not recommended for the first version.

## Security Notes

The pre-shared key should be stored in Vercel as an environment variable and sent by Loxone as an HTTP header if the Loxone HTTP function supports custom headers. If custom headers are not practical in the Loxone PicoC environment, use a query parameter such as `?key=<secret>` as a fallback.

Header authentication is preferred because it keeps the URL cleaner and reduces accidental logging of the secret. Query authentication is still acceptable for this private home automation integration if the Vercel endpoint uses HTTPS and the key is rotated after accidental exposure.

The service should not expose the forecast.solar API key to Loxone. Forecast.solar credentials, if used, belong only in Vercel environment variables.

## Monorepo and Package Management

The service should live in a pnpm-managed monorepo layout so C automation code and API code can evolve independently but stay in one repository.

Recommended structure:

```text
home-automation/
  apps/
    home-automation-api/
  src/
  build/
  package.json
  pnpm-workspace.yaml
  CMakeLists.txt
```

Guidelines:

- Keep current CMake/C sources unchanged during initial monorepo onboarding.
- Add Node/Fastify tooling only under `apps/home-automation-api`.
- Use root workspace scripts for filter-based development and CI.
- Keep endpoint scope-based naming (`/api/pv/production-prediction`) without path versioning.

## Deployment

The implemented service lives in `apps/home-automation-api` and is managed by pnpm workspaces at the repository root.

Deployment checklist:

1. Set Vercel **Root Directory** to `apps/home-automation-api`.
2. Configure `HOME_AUTOMATION_API_KEY` and optional `FORECAST_SOLAR_API_KEY`.
3. Deploy and verify `GET /api/pv/production-prediction` returns plain text on `200`.
4. Point the Loxone PV block at the deployed domain and scoped endpoint path.

See [apps/home-automation-api/README.md](../apps/home-automation-api/README.md) for local development, environment variables, and the exact Loxone request format.

## Caching and Rate Limits

The existing script should not be triggered more than once per day. The Vercel service should still add defensive caching because Loxone restarts, manual testing, or repeated triggers could otherwise consume forecast.solar quota.

Recommended service cache behavior:

- Cache successful responses for at least one hour.
- Allow stale data for several hours when forecast.solar is temporarily unavailable.
- Do not cache `401` or `400` responses.
- Consider returning the most recent successful prediction during upstream `503` only if stale data is explicitly acceptable.

For a control system, stale successful data is often better than overwriting outputs with zero. The C script should not set predictions to zero on retrieval failure.

## Testing Strategy

Service tests:

- Valid key returns `200` and named plain text.
- Missing or wrong key returns `401`.
- Invalid query parameters return `400` if query parameters are supported.
- Upstream forecast.solar `503` maps to service `503`.
- Malformed upstream JSON maps to `502`.
- Unit conversion from Wh to kWh happens exactly once.
- East and west panel predictions are summed correctly.

C tests:

- Plain-text parser extracts `today` and `tomorrow`.
- Parser accepts either line order.
- Parser rejects missing values.
- Parser rejects non-numeric values.
- HTTP status parser identifies `200`, `400`, `401`, `503`, and malformed responses.
- Failed retrieval does not update production outputs to zero.

## Migration Plan

1. Add the Vercel service in a separate app or package.
2. Implement the plain-text endpoint with full query parameter support.
3. Add service tests using mocked forecast.solar responses.
4. Replace `forecast_solar.c`, `forecast_solar.h`, and `nx_json` usage in the PV prediction bundle with a small plain-text parser.
5. Update the CMake bundle inputs to remove `nx_json` and forecast.solar-specific parser code from this block.
6. Add parser tests for the new C helper.
7. Deploy the Vercel service and configure the pre-shared key.
8. Update Loxone constants to point at the Vercel domain.
9. Validate one manual trigger before enabling the daily schedule.

## Open Questions

- Does Loxone PicoC `httpget()` support custom request headers? If not, authentication should use a query parameter in the first version.
- Should the service return stale cached values on upstream failure, or should it return a failure status and leave Loxone outputs unchanged?
- Should the endpoint include a `generatedAt` line later for debugging, for example `generatedAt=2026-05-24T18:00:00Z`?

## Recommendation

Use a Fastify-based Vercel-hosted plain-text facade with named values and HTTP status based error handling. Require full PV query parameters from the first release, keep forecast.solar credentials in Vercel environment variables, and place the endpoint under `/api/pv/production-prediction`. Loxone should make one authenticated request, require `200 OK`, parse `today` and `tomorrow`, and leave existing outputs untouched on failure.

This removes the most fragile part of the current Loxone block while keeping the runtime protocol intentionally small enough for C string scanning.
