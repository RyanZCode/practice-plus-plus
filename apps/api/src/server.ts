import { createPrismaDailyPlanStore } from "./dailyPlan.js";
import { createPrismaContextAssembler } from "./context.js";
import { createPrismaTutorStore } from "./tutor.js";
import { createProviderAdapter } from "./providers.js";
import { createApp } from "./app.js";
import { createPrismaAttemptStore } from "./attempts.js";
import { createSupabaseAccessTokenVerifier } from "./auth.js";
import { createPrismaCatalogStore } from "./catalog.js";
import { createPrismaCatalogImportStore } from "./catalogImport.js";
import { createPrismaCatalogReviewStore } from "./catalogReview.js";
import { readConfig } from "./config.js";
import { createDatabase } from "./database.js";
import { createLogger } from "./logger.js";
import { createPrismaProfileStore } from "./profile.js";
import { createPrismaSettingsStore } from "./settings.js";

const config = readConfig();
const logger = createLogger();
const database = createDatabase(config.databaseUrl);
const app = createApp({
  authentication: {
    tutor: {
      assembler: createPrismaContextAssembler(database),
      provider: createProviderAdapter(),
      store: createPrismaTutorStore(database),
    },
    coach: { assembler: createPrismaContextAssembler(database), provider: createProviderAdapter() },
    dailyPlanStore: createPrismaDailyPlanStore(database),
    attemptStore: createPrismaAttemptStore(database),
    catalogStore: createPrismaCatalogStore(database),
    catalogImportStore: createPrismaCatalogImportStore(database),
    catalogReviewStore: createPrismaCatalogReviewStore(database),
    profileStore: createPrismaProfileStore(database),
    settingsStore: createPrismaSettingsStore(database),
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
