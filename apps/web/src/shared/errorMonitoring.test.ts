import * as Sentry from "@sentry/browser";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initializeErrorMonitoring, reportError } from "./errorMonitoring";

const envelopes: unknown[] = [];
vi.mock("@sentry/browser", async (importOriginal) => {
  const sdk = await importOriginal<typeof Sentry>();
  return {
    ...sdk,
    init: vi.fn((options) =>
      sdk.init({
        ...options,
        transport: () => ({
          send: async (envelope: unknown) => {
            envelopes.push(envelope);
            return { statusCode: 200 };
          },
          flush: async () => true,
        }),
      }),
    ),
  };
});

afterEach(async () => {
  await Sentry.close();
  envelopes.length = 0;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("browser error monitoring", () => {
  it("excludes private content from the real SDK transport", async () => {
    vi.stubGlobal("window", { addEventListener: vi.fn() });
    initializeErrorMonitoring("https://public@example.com/1", "staging", "test-release");
    Sentry.captureEvent({
      message: "React rendering failed",
      user: { email: "private-email" },
      request: {
        url: "https://example.com/?key=private-key",
        headers: { cookie: "private-cookie" },
      },
      exception: { values: [{ value: "private-code" }] },
      breadcrumbs: [{ message: "private-prompt" }],
      extra: { response: "private-response" },
      tags: { userId: "private-id" },
    });
    await Sentry.flush();
    expect(JSON.stringify(envelopes)).toContain("React rendering failed");
    expect(JSON.stringify(envelopes)).not.toContain("private-");
    expect(JSON.stringify(envelopes)).not.toContain("breadcrumbs");
    Sentry.captureException(new Error("private-unapproved-error"));
    await Sentry.flush();
    expect(envelopes).toHaveLength(1);
  });

  it("reports runtime and promise failures using fixed labels", async () => {
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    initializeErrorMonitoring("https://public@example.com/1", "staging", undefined);
    target.dispatchEvent(new Event("error"));
    target.dispatchEvent(new Event("unhandledrejection"));
    reportError("component");
    await Sentry.flush();
    expect(envelopes).toHaveLength(3);
  });

  it("stays disabled without configuration and disables automatic data collection", () => {
    initializeErrorMonitoring(undefined, undefined, undefined);
    expect(Sentry.init).not.toHaveBeenCalled();
    vi.stubGlobal("window", { addEventListener: vi.fn() });
    initializeErrorMonitoring("https://public@example.com/1", "staging", undefined);
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultIntegrations: false,
        sendClientReports: false,
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
        transportOptions: { fetchOptions: { credentials: "omit", referrerPolicy: "no-referrer" } },
      }),
    );
  });
});
