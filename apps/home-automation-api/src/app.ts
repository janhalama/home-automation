/*
This module is the Vercel serverless entrypoint for the home automation API.
It default-exports the request handler expected by Vercel Fastify deployments.
*/

import type { IncomingMessage, ServerResponse } from "node:http";
import Fastify from "fastify";
import { createApp } from "./create-app.js";

void Fastify; // imported so Vercel's entrypoint scanner recognises this as a Fastify app

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
