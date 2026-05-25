# home-automation-api

Fastify API deployed to Vercel for home automation integrations. The first scoped endpoint is PV production prediction.

## Endpoint

```text
GET /api/pv/production-prediction?lat=50.6920036&lon=15.2203556&slope=45&eastAzimuth=-63&eastKwp=5.5&westAzimuth=113&westKwp=4.5
X-API-Key: <pre-shared-key>
```

Success response (`200`):

```text
today=12.340
tomorrow=17.000
```

Error responses use HTTP status codes (`400`, `401`, `502`, `503`, `504`) with optional plain-text bodies such as `error=unauthorized`.

If Loxone cannot send custom headers, pass `apiKey=<pre-shared-key>` as a query parameter instead.

## Local Development

From the repository root:

```bash
pnpm install
cp .env.example .env
pnpm api:dev
```

Local development loads environment variables from:

1. `.env` in the repository root
2. `apps/home-automation-api/.env` (optional override)

Test the endpoint:

```bash
curl -sS \
  -H "X-API-Key: your-secret-key" \
  "http://localhost:3000/api/pv/production-prediction?lat=50.6920036&lon=15.2203556&slope=45&eastAzimuth=-63&eastKwp=5.5&westAzimuth=113&westKwp=4.5"
```

## Scripts

```bash
pnpm api:dev
pnpm api:test
pnpm api:build
pnpm --filter home-automation-api typecheck
```

## Environment Variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `HOME_AUTOMATION_API_KEY` | yes | — | Pre-shared key for Loxone requests to **your** API |
| `FORECAST_SOLAR_API_KEY` | no | empty | **Leave empty on the free tier.** forecast.solar free access needs no API key (today + tomorrow, hourly data). Only set this if you have a paid subscription with a valid key. |
| `FORECAST_SOLAR_TIMEOUT_MS` | no | `8000` | Upstream request timeout in milliseconds |
| `CACHE_TTL_SECONDS` | no | `3600` | Cache-Control `s-maxage` for successful responses |
| `PORT` | no | `3000` | Local development port |

## Vercel Deployment

1. Create a Vercel project from this repository.
2. Set **Root Directory** to `apps/home-automation-api`.
3. Leave the default **Framework Preset** as Vercel auto-detected Fastify/Node, or set it to **Other**.
4. Set **Install Command** to `cd ../.. && pnpm install`.
5. Leave **Build Command** empty unless you want a typecheck step. Vercel bundles `src/index.ts` directly for the serverless function.
6. Add environment variables in the Vercel dashboard (`HOME_AUTOMATION_API_KEY` is required).
7. Deploy.

Do not add a `functions` pattern for `src/index.ts` in `vercel.json`. That pattern only applies to files under the `api/` directory and will fail deployment.

The serverless entrypoint is `src/index.ts`, which forwards requests to the Fastify app in `src/app.ts`.

## Loxone Integration

Update the PV prediction block to call the deployed service instead of forecast.solar directly:

```text
SERVER_ADDRESS "<your-vercel-domain>"
URL_PATH "/api/pv/production-prediction?lat=...&lon=...&slope=...&eastAzimuth=...&eastKwp=...&westAzimuth=...&westKwp=...&apiKey=..."
```

The C script should:

- Treat HTTP `200` as success.
- Parse `today=` and `tomorrow=` lines from the plain-text body.
- Leave existing outputs unchanged on auth, validation, or upstream failures.
