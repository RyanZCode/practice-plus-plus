import { createServer, type Server } from "node:http";

import type { Express } from "express";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "./app.js";

const servers: Server[] = [];

async function startServer(app: Express): Promise<string> {
  const server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  servers.push(server);

  const address = server.address();

  if (address === null || typeof address === "string") {
    throw new Error("Test server did not start on a TCP port");
  }

  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error === undefined ? resolve() : reject(error)));
        }),
    ),
  );
});

describe("API", () => {
  it("lists only public provider metadata for authenticated users", async () => {
    const url = await startServer(
      createApp({
        authentication: {
          profileStore: { resolveByAuthSubject: vi.fn() },
          verifier: { verify: vi.fn().mockResolvedValue({ subject: "verified-subject" }) },
        },
        logger: pino({ level: "silent" }),
      }),
    );
    expect((await fetch(`${url}/ai/providers`)).status).toBe(401);
    const response = await fetch(`${url}/ai/providers`, {
      headers: { authorization: "Bearer valid-token" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ providers: [{ id: "openai", name: "OpenAI" }] });
  });

  it("reports liveness", async () => {
    const url = await startServer(createApp({ logger: pino({ level: "silent" }) }));
    const response = await fetch(`${url}/health/live`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("reports readiness", async () => {
    const url = await startServer(createApp({ logger: pino({ level: "silent" }) }));
    const response = await fetch(`${url}/health/ready`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
  });

  it("reports a failed readiness check without exposing its error", async () => {
    const app = createApp({
      logger: pino({ level: "silent" }),
      readinessChecks: [
        {
          name: "database",
          run: () => Promise.reject(new Error("connection details")),
        },
      ],
    });
    const url = await startServer(app);
    const response = await fetch(`${url}/health/ready`);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
  });

  it("returns a consistent error for an unknown route", async () => {
    const url = await startServer(createApp({ logger: pino({ level: "silent" }) }));
    const response = await fetch(`${url}/missing`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
  });

  it("creates or resolves the authenticated user's application profile", async () => {
    const resolveByAuthSubject = vi.fn().mockResolvedValue({
      authSubject: "verified-subject",
      createdAt: new Date("2026-09-04T12:00:00Z"),
      id: "application-profile-id",
      role: "USER",
      updatedAt: new Date("2026-09-04T12:00:00Z"),
    });
    const app = createApp({
      authentication: {
        profileStore: { resolveByAuthSubject },
        verifier: {
          verify: vi.fn().mockResolvedValue({ subject: "verified-subject" }),
        },
      },
      logger: pino({ level: "silent" }),
    });
    const url = await startServer(app);
    const response = await fetch(`${url}/profile?userId=request-supplied-user`, {
      headers: { authorization: "Bearer valid-token" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "application-profile-id" });
    expect(resolveByAuthSubject).toHaveBeenCalledWith("verified-subject");
  });

  it("loads and saves only the authenticated user's settings", async () => {
    const settings = {
      defaultAiModel: "gpt-5.4-mini",
      reasoningEffort: null,
      attemptTimerMinutes: 30,
      dailyTarget: 2,
      redoIntervals: { high: 1, low: 7, medium: 3 },
      resetTime: "04:00",
      timeZone: "America/Toronto",
    };
    const findByUserProfileId = vi.fn().mockResolvedValue(null);
    const save = vi.fn().mockResolvedValue(settings);
    const app = createApp({
      authentication: {
        profileStore: {
          resolveByAuthSubject: vi.fn().mockResolvedValue({
            authSubject: "verified-subject",
            createdAt: new Date("2026-09-04T12:00:00Z"),
            id: "authenticated-profile-id",
            role: "USER",
            updatedAt: new Date("2026-09-04T12:00:00Z"),
          }),
        },
        settingsStore: { findByUserProfileId, save },
        verifier: {
          verify: vi.fn().mockResolvedValue({ subject: "verified-subject" }),
        },
      },
      logger: pino({ level: "silent" }),
      webOrigin: "http://localhost:5173",
    });
    const url = await startServer(app);
    const headers = { authorization: "Bearer valid-token" };

    const getResponse = await fetch(`${url}/settings?userId=other-profile`, { headers });
    expect(getResponse.status).toBe(200);
    expect(await getResponse.json()).toEqual({ settings: null });
    expect(findByUserProfileId).toHaveBeenCalledWith("authenticated-profile-id");

    const putResponse = await fetch(`${url}/settings`, {
      body: JSON.stringify(settings),
      headers: { ...headers, "content-type": "application/json" },
      method: "PUT",
    });
    expect(putResponse.status).toBe(200);
    expect(await putResponse.json()).toEqual({ settings });
    expect(save).toHaveBeenCalledWith("authenticated-profile-id", settings);
    expect(putResponse.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });

  it("rejects invalid practice settings before application logic runs", async () => {
    const save = vi.fn();
    const app = createApp({
      authentication: {
        profileStore: {
          resolveByAuthSubject: vi.fn().mockResolvedValue({
            authSubject: "verified-subject",
            createdAt: new Date("2026-09-04T12:00:00Z"),
            id: "authenticated-profile-id",
            role: "USER",
            updatedAt: new Date("2026-09-04T12:00:00Z"),
          }),
        },
        settingsStore: { findByUserProfileId: vi.fn(), save },
        verifier: {
          verify: vi.fn().mockResolvedValue({ subject: "verified-subject" }),
        },
      },
      logger: pino({ level: "silent" }),
    });
    const url = await startServer(app);
    const response = await fetch(`${url}/settings`, {
      body: JSON.stringify({
        dailyTarget: 20,
        redoIntervals: { high: 7, low: 1, medium: 3 },
        resetTime: "25:00",
        timeZone: "somewhere",
      }),
      headers: {
        authorization: "Bearer valid-token",
        "content-type": "application/json",
      },
      method: "PUT",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid practice settings" });
    expect(save).not.toHaveBeenCalled();
  });
});
