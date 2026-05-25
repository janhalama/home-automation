/*
This module starts the Fastify API for local development.
It reuses the same application builder used by serverless deployment.
*/

import "./config/load-env.js";
import { createApp } from "./app.js";

/* Start the API process in local development mode. */
async function startServer(): Promise<void> {
  const app = createApp();
  await app.listen({
    host: "0.0.0.0",
    port: Number.parseInt(process.env.PORT ?? "3000", 10)
  });
}

startServer().catch((error) => {
  console.error(error);
  process.exit(1);
});
