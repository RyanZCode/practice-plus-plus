import { createPrismaDailyPlanStore } from "../features/daily-plan/dailyPlan.js";
import { createPrismaContextAssembler } from "../features/learning-context/context.js";
import { createPrismaTutorStore } from "../features/tutor/tutor.js";
import { createProviderAdapter } from "../shared/providers.js";
import { createApp } from "./app.js";
import { createPrismaAttemptStore } from "../features/attempts/attempts.js";
import { createSupabaseAccessTokenVerifier } from "../shared/auth.js";
import { createPrismaCatalogStore } from "../features/catalog/catalog.js";
import { createPrismaCatalogImportStore } from "../features/catalog/catalogImport.js";
import { createPrismaCatalogReviewStore } from "../features/catalog/catalogReview.js";
import { readConfig } from "../shared/config.js";
import { createDatabase } from "../shared/database.js";
import { createLogger } from "../shared/logger.js";
import { createPrismaProfileStore } from "../features/account/profile.js";
import { createPrismaSettingsStore } from "../features/account/settings.js";
import { createPrismaSummaryStore } from "../features/learning-context/summaries.js";
import { createPrismaLearningContextStore } from "../features/learning-context/learningContext.js";
import { createPrismaAssessmentStore } from "../features/assessments/assessments.js";
import { createPrismaAnalyticsStore } from "../features/analytics/analytics.js";

const config = readConfig();
const logger = createLogger();
const database = createDatabase(config.databaseUrl);
const contextAssembler = createPrismaContextAssembler(database);
const provider = createProviderAdapter();
const dailyPlanStore = createPrismaDailyPlanStore(database);
const app = createApp({
  authentication: {
    tutor: {
      assembler: contextAssembler,
      provider,
      store: createPrismaTutorStore(database),
    },
    coach: { assembler: contextAssembler, provider },
    summaries: {
      assembler: contextAssembler,
      provider,
      store: createPrismaSummaryStore(database),
    },
    assessments: {
      assembler: contextAssembler,
      provider,
      store: createPrismaAssessmentStore(database),
    },
    externalAiExport: { assembler: contextAssembler },
    planning: { assembler: contextAssembler, provider, store: dailyPlanStore },
    dailyPlanStore,
    attemptStore: createPrismaAttemptStore(database),
    catalogStore: createPrismaCatalogStore(database),
    catalogImportStore: createPrismaCatalogImportStore(database),
    catalogReviewStore: createPrismaCatalogReviewStore(database),
    profileStore: createPrismaProfileStore(database),
    settingsStore: createPrismaSettingsStore(database),
    learningContextStore: createPrismaLearningContextStore(database),
    analyticsStore: createPrismaAnalyticsStore(database),
    verifier: createSupabaseAccessTokenVerifier(config.supabaseUrl, config.supabasePublishableKey),
  },
  logger,
  readinessChecks: [
    {
      name: "database",
      async run() {
        await database.$queryRaw`SELECT 1`;
      },
    },
  ],
  webOrigin: config.webOrigin,
});

app.listen(config.port, () => {
  logger.info({ port: config.port }, "API listening");
});
