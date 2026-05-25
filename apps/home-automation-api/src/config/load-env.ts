/*
This module loads local environment variables from .env files for development.
It checks the monorepo root first, then the app directory for overrides.
*/

import { config } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRootEnvPath = resolve(currentDir, "../../../../.env");
const appEnvPath = resolve(currentDir, "../../.env");

/* Load root .env first, then optional app-level overrides. */
export function loadLocalEnvironment(): void {
  if (existsSync(repoRootEnvPath))
    config({ path: repoRootEnvPath });

  if (existsSync(appEnvPath))
    config({ path: appEnvPath, override: true });
}

loadLocalEnvironment();
