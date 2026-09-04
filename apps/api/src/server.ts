import { createApp } from "./app.js";
import { createSupabaseAccessTokenVerifier } from "./auth.js";
import { readConfig } from "./config.js";
import { createDatabase } from "./database.js";
import { createLogger } from "./logger.js";
import { createPrismaProfileStore } from "./profile.js";

const config = readConfig();
const logger = createLogger();
const database = createDatabase(config.databaseUrl);
const app = createApp({
  authentication: {
    profileStore: createPrismaProfileStore(database),
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
});

app.listen(config.port, () => {
  logger.info({ port: config.port }, "API listening");
});
