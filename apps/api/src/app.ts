import express, { type Express } from "express";
import type { Logger } from "pino";
import { pinoHttp } from "pino-http";

import { handleError, notFound } from "./errors.js";
import { createHealthRouter, type ReadinessCheck } from "./health.js";
import { createLogger } from "./logger.js";

interface AppOptions {
  logger?: Logger;
  readinessChecks?: readonly ReadinessCheck[];
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();
  const logger = options.logger ?? createLogger();

  app.disable("x-powered-by");
  app.use(pinoHttp({ logger }));
  app.use("/health", createHealthRouter(options.readinessChecks));
  app.use(notFound);
  app.use(handleError);

  return app;
}
