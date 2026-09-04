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
});
