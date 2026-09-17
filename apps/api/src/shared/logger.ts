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
  serializers: {
    err(error: unknown) {
      return {
        type:
          error instanceof Error
            ? error.name
            : typeof error === "object" && error !== null
              ? "UnknownError"
              : typeof error,
      };
    },
  },
};

export function createLogger(destination?: DestinationStream): Logger {
  return destination === undefined ? pino(options) : pino(options, destination);
}
