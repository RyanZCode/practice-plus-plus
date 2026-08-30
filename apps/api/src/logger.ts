import pino, { type DestinationStream, type Logger, type LoggerOptions } from "pino";

const options: LoggerOptions = {
  redact: {
    paths: [
      "req.headers.authorization",
      "authorization",
      "password",
      "token",
      "apiKey",
      "secret",
      "*.authorization",
      "*.password",
      "*.token",
      "*.apiKey",
      "*.secret",
    ],
    censor: "[Redacted]",
  },
};

export function createLogger(destination?: DestinationStream): Logger {
  return destination === undefined ? pino(options) : pino(options, destination);
}
