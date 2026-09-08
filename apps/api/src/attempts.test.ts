import { createServer, type Server } from "node:http";
import type { Attempt } from "@practice-plus-plus/contracts";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { createPrismaAttemptStore, type AttemptStore } from "./attempts.js";
import type { PrismaClient } from "./generated/prisma/client.js";

const userId = "25d64b95-b7cc-4fe5-91ac-ae296dc66383";
const problemId = "6931f7d2-86fc-43de-b7db-dcc636528fc1";
const attempt: Attempt = {
  id: "d3b65a55-1a50-43e1-82e0-e23a263925a5",
  type: "FRESH",
  practiceDate: "2026-09-06",
  startedAt: "2026-09-07T03:00:00.000Z",
  timerSkippedAt: null,
  problem: {
    id: problemId,
    leetcodeId: 1,
    title: "Two Sum",
    slug: "two-sum",
    url: "https://leetcode.com/problems/two-sum/",
    difficulty: "EASY",
    availability: "PAID_ONLY",
  },
};
const record = {
  ...attempt,
  practiceDate: new Date("2026-09-06T00:00:00Z"),
  startedAt: new Date(attempt.startedAt),
};
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});
async function server(store: AttemptStore) {
  const app = createApp({
    logger: pino({ level: "silent" }),
    authentication: {
      attemptStore: store,
      profileStore: {
        resolveByAuthSubject: vi.fn().mockResolvedValue({ id: userId, role: "USER" }),
      },
      verifier: { verify: vi.fn().mockResolvedValue({ subject: "subject" }) },
    },
  });
  const instance = createServer(app);
  servers.push(instance);
  await new Promise<void>((resolve) => instance.listen(0, "127.0.0.1", resolve));
  const address = instance.address();
  if (address === null || typeof address === "string") throw new Error("No port");
  return `http://127.0.0.1:${address.port}`;
}
const headers = { authorization: "Bearer test", "content-type": "application/json" };
describe("attempt routes", () => {
  it("requires authentication and uses the verified profile for every operation", async () => {
    const store = {
      active: vi.fn().mockResolvedValue(attempt),
      start: vi.fn().mockResolvedValue(attempt),
      skip: vi.fn().mockResolvedValue(attempt),
    };
    const url = await server(store);
    expect((await fetch(`${url}/attempts/active`)).status).toBe(401);
    expect(
      (
        await fetch(`${url}/attempts`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ problemId }),
        })
      ).status,
    ).toBe(401);
    expect(
      (await fetch(`${url}/attempts/${attempt.id}/skip-timer`, { method: "POST" })).status,
    ).toBe(401);
    const active = await fetch(`${url}/attempts/active`, { headers });
    expect(await active.json()).toEqual({ attempt });
    const started = await fetch(`${url}/attempts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ problemId }),
    });
    expect(await started.json()).toEqual(attempt);
    await fetch(`${url}/attempts/${attempt.id}/skip-timer`, { method: "POST", headers });
    expect(store.active).toHaveBeenCalledExactlyOnceWith(userId);
    expect(store.start).toHaveBeenCalledWith(userId, problemId, expect.any(Date));
    expect(store.skip).toHaveBeenCalledWith(userId, attempt.id, expect.any(Date));
  });
  it("rejects client-supplied ownership, type, practice date, and invalid identifiers", async () => {
    const store = { active: vi.fn(), start: vi.fn(), skip: vi.fn() };
    const url = await server(store);
    for (const extra of [
      { userProfileId: userId },
      { type: "REDO" },
      { practiceDate: "2026-09-01" },
      { problemId: "invalid" },
    ]) {
      expect(
        (
          await fetch(`${url}/attempts`, {
            method: "POST",
            headers,
            body: JSON.stringify({ problemId, ...extra }),
          })
        ).status,
      ).toBe(400);
    }
    expect(
      (await fetch(`${url}/attempts/invalid/skip-timer`, { method: "POST", headers })).status,
    ).toBe(400);
    expect(store.start).not.toHaveBeenCalled();
    expect(store.skip).not.toHaveBeenCalled();
  });
});
function database() {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    attempt: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(record),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    problem: { findFirst: vi.fn().mockResolvedValue({ id: problemId }) },
    practiceSettings: {
      findUnique: vi.fn().mockResolvedValue({ timeZone: "America/Toronto", resetMinutes: 240 }),
    },
  };
  const client = {
    ...tx,
    $transaction: async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as PrismaClient;
  return { tx, store: createPrismaAttemptStore(client) };
}
describe("attempt persistence", () => {
  it.each([false, true])(
    "derives type from confirmed user history (previous: %s) and calculates practice date",
    async (previous) => {
      const { tx, store } = database();
      tx.attempt.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(previous ? { id: "previous" } : null);
      const result = await store.start(userId, problemId, new Date(attempt.startedAt));
      expect(tx.$queryRaw).toHaveBeenCalled();
      expect(tx.problem.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: problemId, published: true, availability: { not: "UNAVAILABLE" } },
        }),
      );
      expect(tx.attempt.findFirst).toHaveBeenLastCalledWith({
        where: { userProfileId: userId, problemId, confirmedAt: { not: null } },
        select: { id: true },
      });
      expect(tx.attempt.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            userProfileId: userId,
            problemId,
            type: previous ? "REDO" : "FRESH",
            practiceDate: new Date("2026-09-06T00:00:00Z"),
            startedAt: new Date(attempt.startedAt),
          },
        }),
      );
      expect(result).toEqual(attempt);
      expect(JSON.stringify(tx.attempt.create.mock.calls)).not.toContain("problemPatterns");
    },
  );
  it("resumes the same problem and rejects a second active problem", async () => {
    const { tx, store } = database();
    tx.attempt.findFirst.mockResolvedValue(record);
    expect(await store.start(userId, problemId, new Date())).toEqual(attempt);
    await expect(store.start(userId, "other", new Date())).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(tx.attempt.create).not.toHaveBeenCalled();
  });
  it("rejects missing settings and ineligible problems", async () => {
    const { tx, store } = database();
    tx.problem.findFirst.mockResolvedValue(null);
    await expect(store.start(userId, problemId, new Date())).rejects.toThrow("Eligible problem");
    tx.practiceSettings.findUnique.mockResolvedValue(null);
    await expect(store.start(userId, problemId, new Date())).rejects.toThrow("practice settings");
    expect(tx.attempt.create).not.toHaveBeenCalled();
  });
  it("scopes skip and active reads to the owner and preserves the original skip timestamp", async () => {
    const { tx, store } = database();
    expect(await store.active(userId)).toBeNull();
    expect(tx.attempt.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userProfileId: userId, confirmedAt: null } }),
    );
    await expect(store.skip(userId, attempt.id, new Date())).rejects.toThrow(
      "Active attempt not found",
    );
    expect(tx.attempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: attempt.id, userProfileId: userId, confirmedAt: null, timerSkippedAt: null },
      }),
    );
  });
});
