import { createApp } from "./app.js";
import { createLogger } from "./logger.js";

const port = Number(process.env.PORT ?? 3000);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

const logger = createLogger();
const app = createApp({ logger });

app.listen(port, () => {
  logger.info({ port }, "API listening");
});
