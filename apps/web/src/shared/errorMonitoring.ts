import * as Sentry from "@sentry/browser";

const messages = {
  component: "React rendering failed",
  runtime: "Browser runtime error",
  promise: "Unhandled browser promise rejection",
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
    transportOptions: { fetchOptions: { credentials: "omit", referrerPolicy: "no-referrer" } },
    beforeSend(event) {
      const message = Object.values(messages).find((value) => value === event.message);
      if (!message) return null;
      return {
        type: undefined,
        ...(event.event_id ? { event_id: event.event_id } : {}),
        ...(event.timestamp !== undefined ? { timestamp: event.timestamp } : {}),
        level: "error",
        message,
        ...(environment ? { environment } : {}),
        ...(release ? { release } : {}),
        fingerprint: [message],
        tags: { service: "web" },
      };
    },
  });
  window.addEventListener("error", () => reportError("runtime"));
  window.addEventListener("unhandledrejection", () => reportError("promise"));
}

export function reportError(kind: keyof typeof messages): void {
  Sentry.captureEvent({ message: messages[kind], level: "error" });
}
