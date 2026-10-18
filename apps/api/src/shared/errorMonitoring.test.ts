import { createServer } from "node:http";
import express from "express";
import * as Sentry from "@sentry/node";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initializeErrorMonitoring, reportError, reportFailedRequests } from "./errorMonitoring.js";

const envelopes: unknown[] = [];
vi.mock("@sentry/node", async (importOriginal) => {
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
  vi.clearAllMocks();
});

describe("API error monitoring", () => {
  it("sends only approved fields through the real SDK transport", async () => {
    initializeErrorMonitoring("https://public@example.com/1", "staging", "test-release");
    Sentry.captureEvent({
      message: "API request failed",
      request: { url: "https://private.example/?token=private-token", data: "private-code" },
      user: { email: "private-email" },
      exception: {
        values: [
          { value: "private-prompt", stacktrace: { frames: [{ filename: "private-file" }] } },
        ],
      },
      breadcrumbs: [{ message: "private-response" }],
      extra: { key: "private-key" },
      contexts: { browser: { name: "private-browser" } },
      tags: { status: 503, account: "private-account" },
    });
    await Sentry.flush();
    const serialized = JSON.stringify(envelopes);
    expect(serialized).toContain("API request failed");
    expect(serialized).toContain('"status":503');
    expect(serialized).toContain('"environment":"staging"');
    expect(serialized).not.toContain("private-");
    expect(serialized).not.toContain("breadcrumbs");
    Sentry.captureException(new Error("private-unapproved-error"));
    await Sentry.flush();
    expect(envelopes).toHaveLength(1);
  });

  it("reports server failures without request contents and ignores client errors", async () => {
    initializeErrorMonitoring("https://public@example.com/1", "staging", undefined);
    const app = express();
    app.use(reportFailedRequests);
    app.get("/client", (_request, response) => response.sendStatus(400));
    app.all("/{*path}", (_request, response) => response.sendStatus(503));
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing test address");
      await fetch(`http://127.0.0.1:${address.port}/private-id?key=private-key`, {
        headers: { authorization: "Bearer private-token", cookie: "private-cookie" },
      });
      reportError("stream", 502);
      await fetch(`http://127.0.0.1:${address.port}/client`);
      await Sentry.flush();
      expect(envelopes).toHaveLength(2);
      expect(JSON.stringify(envelopes)).not.toContain("private-");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("does not initialize without a DSN or enable automatic collection", () => {
    initializeErrorMonitoring(undefined, undefined, undefined);
    expect(Sentry.init).not.toHaveBeenCalled();
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
        enableRuntimeChannelInjection: false,
      }),
    );
  });
});
