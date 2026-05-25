/*
This module adapts the Fastify app to Vercel's serverless request handler.
It keeps deployment wiring separate from route and service code.
*/

import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "./app.js";

const app = createApp();
const readyPromise = app.ready();

/* Handle one serverless request by forwarding it to Fastify internals. */
export default async function handler(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  await readyPromise;
  app.server.emit("request", request, response);
}
