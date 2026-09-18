import { createServer, type Server } from "node:http";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../application/app.js";
import {
  aggregatePatternEvidence,
  createPrismaAnalyticsStore,
  type AnalyticsStore,
} from "./analytics.js";
import type { PrismaClient } from "../../shared/generated/prisma/client.js";

const arrays = "10000000-0000-4000-8000-000000000001";
const graphs = "10000000-0000-4000-8000-000000000002";
const stack = "10000000-0000-4000-8000-000000000003";
const userProfileId = "25d64b95-b7cc-4fe5-91ac-ae296dc66383";

function attempt(
  id: number,
  outcome: "INDEPENDENT" | "ASSISTED" | "GAVE_UP" | "INCOMPLETE",
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `20000000-0000-4000-8000-${id.toString().padStart(12, "0")}`,
    type: "FRESH" as const,
    practiceDate: `2026-09-${(9 + id).toString().padStart(2, "0")}`,
    startedAt: `2026-09-${(9 + id).toString().padStart(2, "0")}T12:00:00.000Z`,
    outcome,
    confidence: null,
    optimality: null,
    patternIds: [arrays],
    assistance: [],
    ...overrides,
  };
}

describe("pattern evidence aggregation", () => {
  it("classifies recent fresh evidence and keeps redo outcomes separate", () => {
    const result = aggregatePatternEvidence(
      [
        { id: arrays, name: "Arrays & Hashing" },
        { id: graphs, name: "Graphs" },
        { id: stack, name: "Stack" },
      ],
      [
        attempt(1, "INDEPENDENT", { optimality: "OPTIMAL" }),
        attempt(2, "ASSISTED", {
          assistance: [
            { type: "DEBUGGING", hintLevel: null },
            { type: "DEBUGGING", hintLevel: null },
          ],
        }),
        attempt(3, "GAVE_UP", {
          assistance: [{ type: "SOLUTION_REVIEW", hintLevel: null }],
        }),
        attempt(4, "INDEPENDENT", { confidence: "SHAKY" }),
        attempt(5, "INDEPENDENT"),
        attempt(6, "ASSISTED", {
          type: "REDO",
          assistance: [{ type: "CONCEPTUAL_HINT", hintLevel: 2 }],
        }),
        attempt(7, "INDEPENDENT", { type: "REDO" }),
        attempt(8, "GAVE_UP", { type: "REDO" }),
        attempt(9, "INCOMPLETE", { type: "REDO" }),
      ],
      "2026-09-18",
      {
        exactRedos: [
          {
            sourceAttemptId: "30000000-0000-4000-8000-000000000001",
            dueDate: "2026-09-17",
            problem: {
              leetcodeId: 1,
              title: "Two Sum",
              url: "https://leetcode.com/problems/two-sum/",
            },
          },
          {
            sourceAttemptId: "30000000-0000-4000-8000-000000000002",
            dueDate: "2026-09-18",
            problem: {
              leetcodeId: 20,
              title: "Valid Parentheses",
              url: "https://leetcode.com/problems/valid-parentheses/",
            },
          },
        ],
        transfers: [
          {
            id: "40000000-0000-4000-8000-000000000001",
            sourceAttemptId: "30000000-0000-4000-8000-000000000003",
            dueDate: "2026-09-16",
            patternName: "Graphs",
            sourceProblemTitle: "Number of Islands",
          },
          {
            id: "40000000-0000-4000-8000-000000000002",
            sourceAttemptId: "30000000-0000-4000-8000-000000000004",
            dueDate: "2026-09-19",
            patternName: "Stack",
            sourceProblemTitle: "Daily Temperatures",
          },
        ],
      },
    );

    const evidence = result.patterns[0]!;
    expect(result.summary).toMatchObject({
      freshOutcomes: { independent: 3, assisted: 1, gaveUp: 1 },
      redo: {
        outcomes: { independent: 1, assisted: 1, gaveUp: 1, incomplete: 1 },
        successRate: 2 / 3,
      },
      assistance: { conceptualHint: 1, debugging: 1, solutionReview: 1 },
      reviewWork: {
        overdueExactRedos: 1,
        overdueTransfers: 1,
        dueTodayExactRedos: 1,
        dueTodayTransfers: 0,
        overdueItems: [
          {
            type: "TRANSFER",
            patternName: "Graphs",
            daysOverdue: 2,
          },
          {
            type: "EXACT_REDO",
            problem: { title: "Two Sum" },
            daysOverdue: 1,
          },
        ],
      },
    });
    expect(evidence.classification).toBe("NEEDS_PRACTICE");
    expect(evidence.fresh).toMatchObject({
      sampleCount: 5,
      weightedTotal: 5,
      weightedWeakSignals: 3,
      outcomes: { independent: 3, assisted: 1, gaveUp: 1 },
    });
    expect(evidence.redo).toEqual({
      outcomes: { independent: 1, assisted: 1, gaveUp: 1, incomplete: 1 },
      successRate: 2 / 3,
    });
    expect(evidence.assistance.debugging).toBe(1);
    expect(evidence.highestConceptualHintLevel).toBe(2);
    expect(result.patterns[1]?.classification).toBe("UNTESTED");
    expect(result.patterns[2]?.classification).toBe("UNTESTED");
  });

  it("reports insufficient evidence, split contributions, staleness, and concentration", () => {
    const result = aggregatePatternEvidence(
      [
        { id: arrays, name: "Arrays & Hashing" },
        { id: graphs, name: "Graphs" },
        { id: stack, name: "Stack" },
      ],
      [
        attempt(1, "ASSISTED", {
          practiceDate: "2026-07-01",
          startedAt: "2026-07-01T12:00:00.000Z",
          patternIds: [graphs],
        }),
        attempt(2, "INDEPENDENT", {
          practiceDate: "2026-07-02",
          startedAt: "2026-07-02T12:00:00.000Z",
          patternIds: [stack],
        }),
        ...[5, 6, 7, 8].map((id) =>
          attempt(id, "INDEPENDENT", { patternIds: id === 5 ? [arrays, graphs] : [arrays] }),
        ),
        attempt(10, "GAVE_UP", { practiceDate: "2026-09-20" }),
      ],
      "2026-09-17",
    );

    expect(result.patterns[0]).toMatchObject({
      classification: "INSUFFICIENT_EVIDENCE",
      fresh: { sampleCount: 4, weightedTotal: 3.5 },
      overconcentrated: true,
    });
    expect(result.patterns[1]).toMatchObject({
      classification: "INSUFFICIENT_EVIDENCE",
      stale: false,
    });
    expect(result.patterns[1]?.fresh.weightedTotal).toBe(1.5);
    expect(result.patterns[2]).toMatchObject({
      classification: "INSUFFICIENT_EVIDENCE",
      stale: true,
      lastPracticed: "2026-07-02",
    });
  });

  it("limits classification evidence to the latest ten fresh attempts", () => {
    const attempts = [
      attempt(1, "GAVE_UP", {
        practiceDate: "2026-08-01",
        startedAt: "2026-08-01T12:00:00.000Z",
      }),
      ...Array.from({ length: 10 }, (_, index) =>
        attempt(index + 2, "INDEPENDENT", {
          practiceDate: `2026-09-${(index + 1).toString().padStart(2, "0")}`,
          startedAt: `2026-09-${(index + 1).toString().padStart(2, "0")}T12:00:00.000Z`,
        }),
      ),
    ];
    const evidence = aggregatePatternEvidence(
      [{ id: arrays, name: "Arrays & Hashing" }],
      attempts,
      "2026-09-17",
    ).patterns[0]!;
    expect(evidence.fresh.sampleCount).toBe(10);
    expect(evidence.fresh.weightedWeakSignals).toBe(0);
    expect(evidence.classification).toBe("NO_CURRENT_WEAKNESS_SIGNAL");
  });
});

it("queries only confirmed attempts for the authenticated user", async () => {
  const tx = {
    practiceSettings: {
      findUnique: vi.fn().mockResolvedValue({ timeZone: "UTC", resetMinutes: 0 }),
    },
    pattern: { findMany: vi.fn().mockResolvedValue([]) },
    attempt: { findMany: vi.fn().mockResolvedValue([]) },
    reviewObligation: { findMany: vi.fn().mockResolvedValue([]) },
    transferObligation: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const client = {
    ...tx,
    $transaction: vi
      .fn()
      .mockImplementation(async (queries: Promise<unknown>[]) => Promise.all(queries)),
  } as unknown as PrismaClient;
  await createPrismaAnalyticsStore(client).patternEvidence(
    userProfileId,
    new Date("2026-09-17T12:00:00.000Z"),
  );
  expect(tx.attempt.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { userProfileId, confirmedAt: { not: null }, outcome: { not: null } },
    }),
  );
  expect(tx.reviewObligation.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { resolvedAt: null, sourceAttempt: { userProfileId } } }),
  );
  expect(tx.transferObligation.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { resolvedAt: null, sourceAttempt: { userProfileId } } }),
  );
});

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

it("authenticates pattern analytics and uses the resolved profile", async () => {
  const patternEvidence = vi.fn().mockResolvedValue({
    asOfPracticeDate: "2026-09-17",
    summary: {
      freshOutcomes: { independent: 0, assisted: 0, gaveUp: 0 },
      redo: {
        outcomes: { independent: 0, assisted: 0, gaveUp: 0, incomplete: 0 },
        successRate: null,
      },
      assistance: {
        clarification: 0,
        conceptualHint: 0,
        debugging: 0,
        optimization: 0,
        solutionReview: 0,
      },
      optimality: { optimal: 0, suboptimal: 0, unknownOrOmitted: 0 },
      reviewWork: {
        overdueExactRedos: 0,
        overdueTransfers: 0,
        dueTodayExactRedos: 0,
        dueTodayTransfers: 0,
        overdueItems: [],
      },
    },
    patterns: [],
  });
  const app = createApp({
    logger: pino({ level: "silent" }),
    authentication: {
      analyticsStore: { patternEvidence } satisfies AnalyticsStore,
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
  const url = `http://127.0.0.1:${address.port}/analytics/patterns`;
  expect((await fetch(url)).status).toBe(401);
  expect((await fetch(url, { headers: { authorization: "Bearer test" } })).status).toBe(200);
  expect(patternEvidence).toHaveBeenCalledWith(userProfileId, expect.any(Date));
});

it("authenticates streak analytics, validates the month, and uses the resolved profile", async () => {
  const streak = vi.fn().mockResolvedValue({
    asOfPracticeDate: "2026-09-17",
    currentStreak: 0,
    trackingStartDate: null,
    month: "2026-09",
    days: [],
  });
  const app = createApp({
    logger: pino({ level: "silent" }),
    authentication: {
      analyticsStore: {
        patternEvidence: vi.fn(),
        streak,
      } satisfies AnalyticsStore,
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
  const url = `http://127.0.0.1:${address.port}/analytics/streak`;
  expect((await fetch(url)).status).toBe(401);
  expect(
    (await fetch(`${url}?month=2026-13`, { headers: { authorization: "Bearer test" } })).status,
  ).toBe(400);
  expect(
    (await fetch(`${url}?month=2026-08`, { headers: { authorization: "Bearer test" } })).status,
  ).toBe(200);
  expect(streak).toHaveBeenCalledWith(userProfileId, expect.any(Date), "2026-08");
});
