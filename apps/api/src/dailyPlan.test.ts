import { createServer, type Server } from "node:http";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { createPrismaDailyPlanStore } from "./dailyPlan.js";
import type { PrismaClient } from "./generated/prisma/client.js";

const userProfileId = "25d64b95-b7cc-4fe5-91ac-ae296dc66383";
const problem = {
  id: "6931f7d2-86fc-43de-b7db-dcc636528fc1",
  leetcodeId: 1,
  title: "Two Sum",
  slug: "two-sum",
  url: "https://leetcode.com/problems/two-sum/",
  difficulty: "EASY",
  availability: "AVAILABLE",
};
const now = new Date("2026-09-09T12:00:00Z");
function database() {
  let saved: unknown = null;
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    dailyPlan: {
      findUnique: vi.fn().mockImplementation(async () => saved),
      deleteMany: vi.fn().mockImplementation(async () => {
        saved = null;
        return { count: 1 };
      }),
      create: vi.fn().mockImplementation(async ({ data }) => {
        saved = {
          ...data,
          items: data.items.create.map((item: object) => ({
            ...item,
            id: "d3b65a55-1a50-43e1-82e0-e23a263925a5",
            problem,
            attempt: null,
          })),
        };
        return saved;
      }),
    },
    practiceSettings: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ timeZone: "America/Toronto", resetMinutes: 240, dailyTarget: 2 }),
    },
    userProfile: { findUniqueOrThrow: vi.fn().mockResolvedValue({ hidePaidProblems: false }) },
    problem: {
      findMany: vi
        .fn()
        .mockResolvedValue([
          { ...problem, published: true, problemPatterns: [{ patternId: "hidden-pattern" }] },
        ]),
    },
    attempt: { findMany: vi.fn().mockResolvedValue([]) },
    reviewObligation: { findMany: vi.fn().mockResolvedValue([]) },
    transferObligation: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const client = {
    $transaction: async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as PrismaClient;
  return { tx, store: createPrismaDailyPlanStore(client) };
}

describe("daily plan persistence", () => {
  it("persists once, freezes settings and selections, and strips internal patterns", async () => {
    const { tx, store } = database();
    const first = await store.current(userProfileId, now);
    tx.practiceSettings.findUnique.mockResolvedValue({
      timeZone: "UTC",
      resetMinutes: 0,
      dailyTarget: 1,
    });
    tx.problem.findMany.mockResolvedValue([]);
    expect(await store.current(userProfileId, new Date("2026-09-10T07:59:00Z"))).toEqual(first);
    expect(tx.dailyPlan.create).toHaveBeenCalledTimes(1);
    expect(tx.practiceSettings.findUnique).toHaveBeenCalledTimes(1);
    expect(first.items[0]?.kind).toBe("DIAGNOSTIC");
    expect(JSON.stringify(first)).not.toMatch(/hidden-pattern|patternId|reasons|score/);
    expect(tx.$queryRaw).toHaveBeenCalledBefore(tx.dailyPlan.findUnique);
  });
  it("replaces the previous plan at its captured boundary", async () => {
    const { tx, store } = database();
    await store.current(userProfileId, now);
    const next = await store.current(userProfileId, new Date("2026-09-10T08:00:00Z"));
    expect(next.practiceDate).toBe("2026-09-10");
    expect(tx.dailyPlan.create).toHaveBeenCalledTimes(2);
    expect(tx.dailyPlan.deleteMany).toHaveBeenLastCalledWith({ where: { userProfileId } });
  });
  it("scopes history and obligations to the authenticated user", async () => {
    const { tx, store } = database();
    await store.current(userProfileId, now);
    expect(tx.attempt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userProfileId } }),
    );
    expect(tx.reviewObligation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { resolvedAt: null, sourceAttempt: { userProfileId } } }),
    );
    expect(tx.transferObligation.findMany).toHaveBeenCalledWith({
      where: { resolvedAt: null, attemptId: null, sourceAttempt: { userProfileId } },
    });
  });
  it("reports active and finished attempts without refilling the plan", async () => {
    const { tx, store } = database();
    for (const confirmedAt of [null, now]) {
      tx.dailyPlan.findUnique.mockResolvedValueOnce({
        practiceDate: new Date("2026-09-09T00:00:00Z"),
        timeZone: "UTC",
        resetMinutes: 0,
        target: 2,
        items: [
          {
            id: "d3b65a55-1a50-43e1-82e0-e23a263925a5",
            problem,
            kind: "REDO",
            reason: "REVIEW_DUE",
            attempt: { confirmedAt },
          },
        ],
      });
      expect((await store.current(userProfileId, now)).items[0]?.status).toBe(
        confirmedAt === null ? "ACTIVE" : "FINISHED",
      );
    }
    expect(tx.dailyPlan.create).not.toHaveBeenCalled();
  });
  it("keeps an empty plan stable and requires settings before generation", async () => {
    const { tx, store } = database();
    tx.practiceSettings.findUnique.mockResolvedValueOnce(null);
    await expect(store.current(userProfileId, now)).rejects.toThrow("Save practice settings");
    expect(tx.dailyPlan.deleteMany).not.toHaveBeenCalled();
    tx.problem.findMany.mockResolvedValue([]);
    expect((await store.current(userProfileId, now)).items).toEqual([]);
    await store.current(userProfileId, now);
    expect(tx.dailyPlan.create).toHaveBeenCalledTimes(1);
  });
  it("rejects fabricated recommended problems without changing plan state", async () => {
    const { tx, store } = database();
    await expect(store.recommended(userProfileId, now, [crypto.randomUUID()])).rejects.toThrow(
      "no longer valid",
    );
    expect(tx.dailyPlan.deleteMany).not.toHaveBeenCalled();
    expect(tx.dailyPlan.create).not.toHaveBeenCalled();
  });
});

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});
it("authenticates the plan route and uses the resolved profile", async () => {
  const current = vi.fn().mockResolvedValue({ practiceDate: "2026-09-09", target: 2, items: [] });
  const app = createApp({
    logger: pino({ level: "silent" }),
    authentication: {
      dailyPlanStore: {
        current,
        saved: vi.fn().mockResolvedValue(null),
        recommended: vi.fn(),
      },
      profileStore: {
        resolveByAuthSubject: vi.fn().mockResolvedValue({ id: userProfileId, role: "USER" }),
      },
      verifier: { verify: vi.fn().mockResolvedValue({ subject: "subject" }) },
    },
  });
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No port");
  const url = `http://127.0.0.1:${address.port}/daily-plan`;
  expect((await fetch(url)).status).toBe(401);
  expect(current).not.toHaveBeenCalled();
  expect((await fetch(url, { headers: { authorization: "Bearer test" } })).status).toBe(200);
  expect(current).toHaveBeenCalledWith(userProfileId, expect.any(Date));
});
