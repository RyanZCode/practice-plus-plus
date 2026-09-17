import { createDailyPlanRouter, type DailyPlanStore } from "../features/daily-plan/dailyPlan.js";
import express, { type Express } from "express";
import cors from "cors";
import type { Logger } from "pino";
import { pinoHttp } from "pino-http";

import { createAttemptRouter, type AttemptStore } from "../features/attempts/attempts.js";
import { createCatalogRouter, type CatalogStore } from "../features/catalog/catalog.js";
import {
  createCatalogImportRouter,
  type CatalogImportStore,
} from "../features/catalog/catalogImport.js";
import {
  createCatalogReviewRouter,
  type CatalogReviewStore,
} from "../features/catalog/catalogReview.js";
import {
  getApplicationProfile,
  resolveApplicationProfile,
  type ProfileStore,
} from "../features/account/profile.js";
import { createCoachRouter, type CoachOptions } from "../features/coach/coach.js";
import { createTutorRouter, type TutorOptions } from "../features/tutor/tutor.js";
import { createSettingsRouter, type SettingsStore } from "../features/account/settings.js";
import {
  createSummaryRouter,
  type SummaryOptions,
} from "../features/learning-context/summaries.js";
import {
  createLearningContextRouter,
  type LearningContextStore,
} from "../features/learning-context/learningContext.js";
import {
  createAssessmentRouter,
  type AssessmentOptions,
} from "../features/assessments/assessments.js";
import {
  createExternalAiExportRouter,
  type ExternalAiExportOptions,
} from "../features/external-ai/externalAiExport.js";
import { createPlanningRouter, type PlanningOptions } from "../features/daily-plan/planning.js";
import { createAnalyticsRouter, type AnalyticsStore } from "../features/analytics/analytics.js";
import { requireAuthentication, type AccessTokenVerifier } from "../shared/auth.js";
import { requireAdministrator } from "../features/account/authorization.js";
import { handleError, notFound } from "../shared/errors.js";
import { createHealthRouter, type ReadinessCheck } from "../shared/health.js";
import { createLogger } from "../shared/logger.js";
import { getProviders } from "../shared/providers.js";

interface AuthenticationOptions {
  readonly tutor?: TutorOptions;
  readonly coach?: CoachOptions;
  readonly dailyPlanStore?: DailyPlanStore;
  readonly attemptStore?: AttemptStore;
  readonly catalogStore?: CatalogStore;
  readonly catalogImportStore?: CatalogImportStore;
  readonly catalogReviewStore?: CatalogReviewStore;
  readonly profileStore: ProfileStore;
  readonly settingsStore?: SettingsStore;
  readonly summaries?: SummaryOptions;
  readonly learningContextStore?: LearningContextStore;
  readonly assessments?: AssessmentOptions;
  readonly externalAiExport?: ExternalAiExportOptions;
  readonly planning?: PlanningOptions;
  readonly analyticsStore?: AnalyticsStore;
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

    if (options.authentication.tutor !== undefined) {
      app.use(
        "/ai/tutor",
        authenticate,
        resolveProfile,
        createTutorRouter(options.authentication.tutor),
      );
    }
    if (options.authentication.coach !== undefined) {
      app.use(
        "/ai/coach",
        authenticate,
        resolveProfile,
        createCoachRouter(options.authentication.coach),
      );
    }
    if (options.authentication.assessments !== undefined) {
      app.use(
        "/ai/assessment-drafts",
        authenticate,
        resolveProfile,
        createAssessmentRouter(options.authentication.assessments),
      );
    }
    if (options.authentication.summaries !== undefined) {
      app.use(
        "/ai",
        authenticate,
        resolveProfile,
        createSummaryRouter(options.authentication.summaries),
      );
    }
    if (options.authentication.externalAiExport !== undefined) {
      app.use(
        "/ai/external-context",
        authenticate,
        resolveProfile,
        createExternalAiExportRouter(options.authentication.externalAiExport),
      );
    }
    if (options.authentication.planning !== undefined) {
      app.use(
        "/ai/planning",
        authenticate,
        resolveProfile,
        createPlanningRouter(options.authentication.planning),
      );
    }

    if (
      options.authentication.attemptStore !== undefined ||
      options.authentication.catalogStore !== undefined ||
      options.authentication.settingsStore !== undefined ||
      options.authentication.catalogImportStore !== undefined ||
      options.authentication.catalogReviewStore !== undefined ||
      options.authentication.learningContextStore !== undefined
    ) {
      app.use(express.json());
    }

    app.get("/profile", authenticate, resolveProfile, (request, response) => {
      response.json({ id: getApplicationProfile(request).id });
    });

    app.get("/ai/providers", authenticate, (_request, response) => {
      response.json(getProviders());
    });

    if (options.authentication.dailyPlanStore !== undefined) {
      app.use(
        "/daily-plan",
        authenticate,
        resolveProfile,
        createDailyPlanRouter(options.authentication.dailyPlanStore),
      );
    }

    if (options.authentication.attemptStore !== undefined) {
      app.use(
        "/attempts",
        authenticate,
        resolveProfile,
        createAttemptRouter(options.authentication.attemptStore),
      );
    }

    if (options.authentication.catalogStore !== undefined) {
      app.use(
        "/catalog",
        authenticate,
        resolveProfile,
        createCatalogRouter(options.authentication.catalogStore),
      );
    }

    if (options.authentication.settingsStore !== undefined) {
      app.use(
        "/settings",
        authenticate,
        resolveProfile,
        createSettingsRouter(options.authentication.settingsStore),
      );
    }

    if (options.authentication.learningContextStore !== undefined) {
      app.use(
        "/learning-context",
        authenticate,
        resolveProfile,
        createLearningContextRouter(options.authentication.learningContextStore),
      );
    }

    if (options.authentication.analyticsStore !== undefined) {
      app.use(
        "/analytics",
        authenticate,
        resolveProfile,
        createAnalyticsRouter(options.authentication.analyticsStore),
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
