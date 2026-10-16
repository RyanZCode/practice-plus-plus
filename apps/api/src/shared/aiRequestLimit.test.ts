import { createServer, type Server } from "node:http";
import express, { type Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAiRequestLimit } from "./aiRequestLimit.js";
import { requireAuthentication } from "./auth.js";
import { handleError } from "./errors.js";

const servers: Server[] = [];

async function start() {
  let time = 0;
  const pending: Response[] = [];
  const app = express();
  app.use(
    "/ai",
    requireAuthentication({ verify: async (subject) => ({ subject }) }),
    createAiRequestLimit(() => time),
  );
  app.get("/ai/hold", (_request, response) => pending.push(response));
  app.get("/ai/models", (_request, response) => response.json({ ok: true }));
  app.post("/ai/checkpoints", (_request, response) => response.json({ ok: true }));
  app.get("/health/live", (_request, response) => response.json({ status: "ok" }));
  app.use(handleError);
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Missing server port");
  const url = `http://127.0.0.1:${address.port}`;
  return {
    pending,
    advance: (milliseconds: number) => (time += milliseconds),
    request: (path = "/ai/models", subject = "user-one", options: RequestInit = {}) =>
      fetch(`${url}${path}`, {
        ...options,
        headers: subject ? { authorization: `Bearer ${subject}` } : {},
      }),
  };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.closeAllConnections();
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

describe("AI request limits", () => {
  it("shares the minute allowance across routes and resets it after a minute", async () => {
    const test = await start();
    for (let count = 0; count < 15; count += 1) {
      expect((await test.request()).status).toBe(200);
      expect((await test.request("/ai/checkpoints", "user-one", { method: "POST" })).status).toBe(
        200,
      );
    }
    const rejected = await test.request();
    expect(rejected.status).toBe(429);
    expect(rejected.headers.get("retry-after")).toBe("60");
    expect(await rejected.json()).toEqual({
      error: "Too many AI requests. Try again shortly.",
    });
    test.advance(59_500);
    expect((await test.request()).headers.get("retry-after")).toBe("1");
    test.advance(500);
    expect((await test.request()).status).toBe(200);
  });

  it("isolates users and leaves health checks and unauthenticated traffic outside the allowance", async () => {
    const test = await start();
    expect((await test.request("/ai/models", "")).status).toBe(401);
    for (let count = 0; count < 30; count += 1) {
      expect((await test.request()).status).toBe(200);
    }
    expect((await test.request()).status).toBe(429);
    expect((await test.request("/ai/models", "user-two")).status).toBe(200);
    expect((await test.request("/health/live")).status).toBe(200);
  });

  it("releases concurrency slots after completion and cancellation without double release", async () => {
    const test = await start();
    const controllers = Array.from({ length: 3 }, () => new AbortController());
    const requests = controllers.map((controller) =>
      test.request("/ai/hold", "user-one", { signal: controller.signal }).catch(() => null),
    );
    await vi.waitFor(() => expect(test.pending).toHaveLength(3));
    const rejected = await test.request();
    expect(rejected.status).toBe(429);
    expect(rejected.headers.get("retry-after")).toBe("1");
    expect((await test.request("/ai/models", "user-two")).status).toBe(200);

    test.pending[0]!.json({ done: true });
    expect((await requests[0])?.status).toBe(200);
    const replacement = test.request("/ai/hold");
    await vi.waitFor(() => expect(test.pending).toHaveLength(4));
    expect((await test.request()).status).toBe(429);

    controllers[1]!.abort();
    await requests[1];
    await vi.waitFor(async () => expect((await test.request()).status).toBe(200));
    test.pending[2]!.json({ done: true });
    test.pending[3]!.json({ done: true });
    await Promise.all([requests[2], replacement]);
    expect((await test.request()).status).toBe(200);
  });

  it("keeps the concurrency limit when the minute rolls over during long requests", async () => {
    const test = await start();
    const requests = Array.from({ length: 3 }, () => test.request("/ai/hold"));
    await vi.waitFor(() => expect(test.pending).toHaveLength(3));
    test.advance(60_000);
    expect((await test.request()).status).toBe(429);
    for (const response of test.pending) response.json({ done: true });
    await Promise.all(requests);
    expect((await test.request()).status).toBe(200);
  });
});
