import { createApp } from "./app.js";
import { readConfig } from "./config.js";
import { createLogger } from "./logger.js";

const config = readConfig();
const logger = createLogger();
const app = createApp({ logger });

app.listen(config.port, () => {
  logger.info({ port: config.port }, "API listening");
});
