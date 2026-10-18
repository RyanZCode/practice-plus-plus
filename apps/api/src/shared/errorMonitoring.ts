import * as Sentry from "@sentry/node";
import type { RequestHandler } from "express";

const messages = {
  request: "API request failed",
  stream: "AI stream failed",
} as const;

export function initializeErrorMonitoring(
  dsn: string | undefined,
  environment: string | undefined,
  release: string | undefined,
): void {
  if (!dsn) return;
  Sentry.init({
    dsn,
    defaultIntegrations: false,
    enableOpenTelemetrySetup: false,
    enableRuntimeChannelInjection: false,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      frameContextLines: 0,
    },
    sendClientReports: false,
    maxBreadcrumbs: 0,
    beforeSend(event) {
      const message = Object.values(messages).find((value) => value === event.message);
      if (!message) return null;
      const status = Number(event.tags?.status);
      return {
        type: undefined,
        ...(event.event_id ? { event_id: event.event_id } : {}),
        ...(event.timestamp !== undefined ? { timestamp: event.timestamp } : {}),
        level: "error",
        message,
        ...(environment ? { environment } : {}),
        ...(release ? { release } : {}),
        fingerprint: [message],
        tags: {
          service: "api",
          ...(Number.isInteger(status) && status >= 500 && status <= 599 ? { status } : {}),
        },
      };
    },
  });
}

export function reportError(kind: keyof typeof messages, status?: number): void {
  Sentry.captureEvent({ message: messages[kind], level: "error", tags: { status } });
}

export const reportFailedRequests: RequestHandler = (_request, response, next) => {
  response.on("finish", () => {
    if (response.statusCode >= 500) reportError("request", response.statusCode);
  });
  next();
};
