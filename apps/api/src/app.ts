import express, { type Express } from "express";
import type { Logger } from "pino";
import { pinoHttp } from "pino-http";

import { requireAuthentication, type AccessTokenVerifier } from "./auth.js";
import { handleError, notFound } from "./errors.js";
import { createHealthRouter, type ReadinessCheck } from "./health.js";
import { createLogger } from "./logger.js";
import { getApplicationProfile, resolveApplicationProfile, type ProfileStore } from "./profile.js";

interface AuthenticationOptions {
  readonly profileStore: ProfileStore;
  readonly verifier: AccessTokenVerifier;
}

interface AppOptions {
  authentication?: AuthenticationOptions;
  logger?: Logger;
  readinessChecks?: readonly ReadinessCheck[];
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();
  const logger = options.logger ?? createLogger();

  app.disable("x-powered-by");
  app.use(pinoHttp({ logger }));
  app.use("/health", createHealthRouter(options.readinessChecks));

  if (options.authentication !== undefined) {
    app.get(
      "/profile",
      requireAuthentication(options.authentication.verifier),
      resolveApplicationProfile(options.authentication.profileStore),
      (request, response) => {
        response.json({ id: getApplicationProfile(request).id });
      },
    );
  }

  app.use(notFound);
  app.use(handleError);

  return app;
}
