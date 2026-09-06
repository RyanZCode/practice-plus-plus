import express, { type Express } from "express";
import cors from "cors";
import type { Logger } from "pino";
import { pinoHttp } from "pino-http";

import { requireAuthentication, type AccessTokenVerifier } from "./auth.js";
import { requireAdministrator } from "./authorization.js";
import { createCatalogImportRouter, type CatalogImportStore } from "./catalogImport.js";
import { createCatalogReviewRouter, type CatalogReviewStore } from "./catalogReview.js";
import { handleError, notFound } from "./errors.js";
import { createHealthRouter, type ReadinessCheck } from "./health.js";
import { createLogger } from "./logger.js";
import { getApplicationProfile, resolveApplicationProfile, type ProfileStore } from "./profile.js";
import { createSettingsRouter, type SettingsStore } from "./settings.js";

interface AuthenticationOptions {
  readonly catalogImportStore?: CatalogImportStore;
  readonly catalogReviewStore?: CatalogReviewStore;
  readonly profileStore: ProfileStore;
  readonly settingsStore?: SettingsStore;
  readonly verifier: AccessTokenVerifier;
}

interface AppOptions {
  authentication?: AuthenticationOptions;
  logger?: Logger;
  readinessChecks?: readonly ReadinessCheck[];
  webOrigin?: string;
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();
  const logger = options.logger ?? createLogger();

  app.disable("x-powered-by");
  app.use(pinoHttp({ logger }));
  if (options.webOrigin !== undefined) {
    app.use(cors({ origin: options.webOrigin }));
  }
  app.use("/health", createHealthRouter(options.readinessChecks));

  if (options.authentication !== undefined) {
    const authenticate = requireAuthentication(options.authentication.verifier);
    const resolveProfile = resolveApplicationProfile(options.authentication.profileStore);

    if (
      options.authentication.settingsStore !== undefined ||
      options.authentication.catalogImportStore !== undefined ||
      options.authentication.catalogReviewStore !== undefined
    ) {
      app.use(express.json());
    }

    app.get("/profile", authenticate, resolveProfile, (request, response) => {
      response.json({ id: getApplicationProfile(request).id });
    });

    if (options.authentication.settingsStore !== undefined) {
      app.use(
        "/settings",
        authenticate,
        resolveProfile,
        createSettingsRouter(options.authentication.settingsStore),
      );
    }

    if (options.authentication.catalogImportStore !== undefined) {
      app.use(
        "/admin/catalog/imports",
        authenticate,
        resolveProfile,
        requireAdministrator,
        createCatalogImportRouter(options.authentication.catalogImportStore),
      );
    }

    if (options.authentication.catalogReviewStore !== undefined) {
      app.use(
        "/admin/catalog",
        authenticate,
        resolveProfile,
        requireAdministrator,
        createCatalogReviewRouter(options.authentication.catalogReviewStore),
      );
    }
  }

  app.use(notFound);
  app.use(handleError);

  return app;
}
