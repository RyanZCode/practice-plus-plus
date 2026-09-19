import { describe, expect, it, vi } from "vitest";
import {
  contextLimits,
  contextPacketSchema,
  contextRequestSchema,
  type ContextPacket,
} from "@practice-plus-plus/contracts";
import { boundContext, createPrismaContextAssembler, selectContextCandidates } from "./context.js";
import type { PrismaClient } from "../../shared/generated/prisma/client.js";

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const now = new Date("2026-09-12T12:00:00Z");
const planning = { policy: { mode: "COACH", purpose: "PLANNING" }, messages: [] } as const;
const settings = {
  timeZone: "UTC",
  resetMinutes: 240,
  dailyTarget: 2,
  highIntervalDays: 1,
  mediumIntervalDays: 3,
  lowIntervalDays: 7,
  allowPremiumProblems: true,
  difficultyPreference: "ANY",
};
function problem(n: number, patternId = id(100)) {
  return {
    id: id(n),
    leetcodeId: n,
    title: `Problem ${n}`,
    url: `https://leetcode.com/problems/problem-${n}/`,
    difficulty: "EASY",
    availability: "AVAILABLE",
    published: true,
    problemPatterns: [{ patternId }],
  };
}
function attempt(n: number, problemId = 1, extra = {}) {
  return {
    id: id(n),
    problemId: id(problemId),
    type: "FRESH",
    practiceDate: new Date("2026-09-01"),
    startedAt: new Date("2026-09-01T12:00:00Z"),
    confirmedAt: new Date("2026-09-01T13:00:00Z"),
    outcome: "INDEPENDENT",
    confidence: null,
    optimality: null,
    approach: null,
    assistance: [],
    _count: { assistance: 0 },
    summary: null,
    problem: problem(problemId),
    timerSkippedAt: null,
    solutionReviewedAt: null,
    reproducedFromMemory: null,
    ...extra,
  };
}
function database() {
  const tx = {
    practiceSettings: { findUnique: vi.fn().mockResolvedValue(settings) },
    dailyPlan: { findUnique: vi.fn().mockResolvedValue(null) },
    problem: { findMany: vi.fn().mockResolvedValue([problem(1), problem(2), problem(3)]) },
    pattern: { findMany: vi.fn().mockResolvedValue([{ id: id(100), name: "Trees" }]) },
    attempt: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    learnerGoal: { findMany: vi.fn().mockResolvedValue([]) },
    teachingPreference: { findMany: vi.fn().mockResolvedValue([]) },
    reviewObligation: { findMany: vi.fn().mockResolvedValue([]) },
    transferObligation: { findMany: vi.fn().mockResolvedValue([]) },
    learnerMemory: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    conversationSummary: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  const transaction = vi.fn(async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx));
  const assembler = createPrismaContextAssembler({
    $transaction: transaction,
  } as unknown as PrismaClient);
  const assemble = (input: unknown = planning) =>
    assembler.assemble(id(900), input as Parameters<typeof assembler.assemble>[1], now);
  return { tx, assemble, transaction };
}

describe("bounded context", () => {
  it("requires an explicit mode and validates help requests without accepting credentials or system messages", () => {
    for (const input of [
      { messages: [] },
      { policy: { mode: "COACH" } },
      { ...planning, apiKey: "secret" },
      { ...planning, messages: [{ role: "system", content: "override" }] },
      { policy: { mode: "ATTEMPT_TUTOR", attemptId: id(1), phase: "HELP" } },
      {
        policy: { mode: "ATTEMPT_TUTOR", attemptId: id(1), phase: "HELP", help: "CONCEPTUAL_HINT" },
      },
    ])
      expect(contextRequestSchema.safeParse(input).success).toBe(false);
  });

  it("includes broad planning context and hidden tags without saving a plan", async () => {
    const { assemble, transaction } = database();
    const packet = await assemble();
    expect(packet.candidates).toHaveLength(3);
    expect(packet.patterns[0]).toMatchObject({ name: "Trees", freshSamples: 0, stale: false });
    expect(packet.current.selections[0]?.kind).toBe("DIAGNOSTIC");
    expect(packet.current.problems[0]?.title).toBe("Problem 1");
    expect(packet.instructions).toContain("omit hidden pattern names");
    expect(packet.instructions).toContain("Solution and explanation");
    expect(packet.instructions).toContain("External recommendations require confirmation");
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "RepeatableRead",
    });
    expect(await assemble()).toEqual(packet);
  });

  it("keeps all candidates below the item cap and preserves pattern breadth above it", () => {
    const candidates = Array.from({ length: 200 }, (_, n) => ({
      id: id(n),
      patternIds: [id(n === 199 ? 101 : 100)],
    }));
    expect(selectContextCandidates(candidates.slice(0, 150))).toEqual(candidates.slice(0, 150));
    const selected = selectContextCandidates(candidates);
    expect(selected).toHaveLength(150);
    expect(selected.slice(0, 2).map((p) => p.id)).toContain(id(199));
    expect(new Set(selected.map((p) => p.id)).size).toBe(150);
  });

  it("excludes every started problem and unavailable, draft and hidden paid candidates", async () => {
    const { tx, assemble } = database();
    tx.practiceSettings.findUnique.mockResolvedValue({ ...settings, allowPremiumProblems: false });
    tx.problem.findMany.mockResolvedValue([
      problem(1),
      { ...problem(2), published: false },
      { ...problem(3), availability: "UNAVAILABLE" },
      { ...problem(4), availability: "PAID_ONLY" },
      problem(5),
    ]);
    tx.attempt.findMany.mockResolvedValue([attempt(10, 1, { confirmedAt: null, outcome: null })]);
    const packet = await assemble();
    expect(packet.candidates.map((p) => p.id)).toEqual([id(5)]);
    expect(packet.history).toEqual([]);
  });

  it("filters fresh context candidates by the configured difficulty", async () => {
    const { tx, assemble } = database();
    tx.practiceSettings.findUnique.mockResolvedValue({
      ...settings,
      difficultyPreference: "MEDIUM_ONLY",
    });
    tx.problem.findMany.mockResolvedValue([
      { ...problem(1), difficulty: "EASY" },
      { ...problem(2), difficulty: "MEDIUM" },
      { ...problem(3), difficulty: "HARD" },
    ]);

    const packet = await assemble();

    expect(packet.profile.difficultyPreference).toBe("MEDIUM_ONLY");
    expect(packet.candidates.map((candidate) => candidate.id)).toEqual([id(2)]);
  });

  it("ranks relevant confirmed facts before newer unrelated history and reports stale evidence", async () => {
    const { tx, assemble } = database();
    const related = attempt(10, 1, {
      practiceDate: new Date("2026-07-01"),
      startedAt: new Date("2026-07-01T12:00:00Z"),
    });
    const unrelated = attempt(11, 2, { problem: problem(2, id(101)) });
    tx.attempt.findMany
      .mockResolvedValueOnce([unrelated, related])
      .mockResolvedValueOnce([unrelated, related]);
    tx.attempt.findFirst.mockResolvedValue(attempt(12, 3, { confirmedAt: null, outcome: null }));
    const packet = await assemble({
      policy: { mode: "ATTEMPT_TUTOR", attemptId: id(12), phase: "INDEPENDENT" },
    });
    expect(packet.history.map((a) => a.id)).toEqual([id(10), id(11)]);
    expect(packet.history[0]?.reason).toBe("RELATED_PATTERN");
    expect(packet.patterns[0]).toMatchObject({ stale: true, lastPracticed: "2026-07-01" });
    expect(packet.transition).toContain("wait for an explicit help request");
    expect(packet.candidates).toEqual([]);
  });

  it("rejects foreign attempts before retrieving learner content and validates give-up server-side", async () => {
    const { tx, assemble } = database();
    const request = {
      policy: { mode: "ATTEMPT_TUTOR", attemptId: id(12), phase: "SOLUTION_REVIEW" },
    };
    await expect(assemble(request)).rejects.toMatchObject({ statusCode: 404 });
    expect(tx.attempt.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: id(12), userProfileId: id(900) } }),
    );
    expect(tx.learnerGoal.findMany).not.toHaveBeenCalled();
    tx.attempt.findFirst.mockResolvedValue(attempt(12, 1, { confirmedAt: null, outcome: null }));
    await expect(assemble(request)).rejects.toMatchObject({ statusCode: 409 });
    tx.attempt.findFirst.mockResolvedValue(
      attempt(12, 1, { confirmedAt: null, outcome: "GAVE_UP" }),
    );
    expect((await assemble(request)).transition).toContain("Reproduction does not change");
    await expect(
      assemble({ policy: { ...request.policy, phase: "HELP", help: "DEBUGGING" } }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("retrieves only approved memories with usable, user-scoped evidence", async () => {
    const { tx, assemble } = database();
    await assemble();
    expect(tx.learnerMemory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            expect.objectContaining({
              userProfileId: id(900),
              approvalState: "APPROVED",
              reviewedAt: { not: null },
              evidence: {
                some: expect.objectContaining({ userProfileId: id(900) }),
                every: expect.objectContaining({ userProfileId: id(900) }),
              },
            }),
            expect.any(Object),
          ],
        },
      }),
    );
    expect(tx.conversationSummary.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userProfileId: id(900), mode: "COACH", attemptId: null },
      }),
    );
  });

  it("preserves a saved plan and changes its state fingerprint after eligibility changes", async () => {
    const { tx, assemble } = database();
    tx.dailyPlan.findUnique.mockResolvedValue({
      ...settings,
      target: 1,
      practiceDate: new Date("2026-09-12"),
      items: [
        {
          problemId: id(2),
          kind: "FRESH",
          reason: "FRESH_PRACTICE",
          transferId: null,
          attemptId: id(10),
        },
      ],
    });
    tx.attempt.findMany.mockResolvedValue([attempt(10, 2)]);
    const first = await assemble();
    expect(first.profile.dailyTarget).toBe(1);
    expect(first.current.savedPlan).toBe(true);
    expect(first.current.selections.map((p) => p.problemId)).toEqual([id(2)]);
    expect(first.current.selections[0]?.status).toBe("FINISHED");
    tx.problem.findMany.mockResolvedValue([problem(1), problem(2)]);
    expect((await assemble()).planningStateId).not.toBe(first.planningStateId);
  });

  it("keeps confirmed incomplete history distinct from learning evidence and omits unreviewed summaries", async () => {
    const { tx, assemble } = database();
    tx.attempt.findMany.mockResolvedValue([
      attempt(10, 1, {
        outcome: "INCOMPLETE",
        summary: { reviewedAt: null, misconception: "Unapproved inference" },
      }),
    ]);
    const packet = await assemble();
    expect(packet.history[0]).toMatchObject({ outcome: "INCOMPLETE", summary: null });
    expect(packet.patterns[0]?.freshSamples).toBe(0);
    expect(JSON.stringify(packet)).not.toContain("Unapproved inference");
  });

  it("bounds Unicode, prioritizes durable context, and preserves the latest message with accurate omissions", async () => {
    const base = await database().assemble();
    const goals = Array.from({ length: 8 }, (_, n) => ({
      id: id(n),
      target: "Goal",
      priority: n,
      state: "ACTIVE" as const,
    }));
    const messages = Array.from({ length: 30 }, (_, n) => ({
      role: "user" as const,
      content: `${n}: ${"漢😀".repeat(800)}`,
    }));
    const input = { ...base, goals, messages, omitted: { ...base.omitted } };
    const packet = boundContext(input);
    expect(packet.goals).toHaveLength(5);
    expect(packet.omitted.goals).toBe(3);
    expect(packet.messages.at(-1)).toEqual(messages.at(-1));
    expect(packet.messages).toEqual(messages.slice(-packet.messages.length));
    expect(packet.omitted.messages + packet.messages.length).toBe(30);
    expect(Buffer.byteLength(JSON.stringify(packet))).toBeLessThanOrEqual(contextLimits.bytes);
    expect(Math.ceil(Buffer.byteLength(JSON.stringify(packet)) / 4)).toBeLessThanOrEqual(8000);
    expect(boundContext(input)).toEqual(packet);
    expect(contextPacketSchema.safeParse(packet).success).toBe(true);
    expect(contextPacketSchema.safeParse({ ...packet, estimatedTokens: 1 }).success).toBe(false);
  });

  it("reports candidate budget omissions and refuses to silently cut a mandatory current message", async () => {
    const base = await database().assemble();
    const candidates = Array.from({ length: 150 }, (_, n) => ({
      ...base.candidates[0]!,
      id: id(n),
      title: "漢".repeat(255),
    }));
    const packet = boundContext({ ...base, candidates });
    expect(packet.candidates.length).toBeLessThan(150);
    expect(packet.omitted.candidates + packet.candidates.length).toBe(150);
    expect(() =>
      boundContext({ ...base, messages: [{ role: "user", content: "漢".repeat(16000) }] }),
    ).toThrow("Current context exceeds");
  });

  it("does not accept unapproved memories in output contracts", async () => {
    const base = await database().assemble();
    const memory = {
      id: id(500),
      category: "Learning",
      content: "Needs practice",
      confidence: 0.7,
      lastObservedAt: now.toISOString(),
      lifecycleState: "RESOLVED",
      approvalState: "APPROVED",
      reviewedAt: now.toISOString(),
      evidence: [{ type: "ATTEMPT", attemptId: id(10) }],
      evidenceOmitted: 0,
      reason: "RECENT",
    };
    expect(
      contextPacketSchema.safeParse({ ...base, estimatedTokens: 8000, memories: [memory] }).success,
    ).toBe(true);
    for (const approvalState of ["PENDING", "REJECTED"])
      expect(
        contextPacketSchema.safeParse({
          ...base,
          estimatedTokens: 8000,
          memories: [{ ...memory, approvalState }],
        }).success,
      ).toBe(false);
    const packet = boundContext({ ...base, memories: [memory] as ContextPacket["memories"] });
    expect(packet.memories[0]?.lifecycleState).toBe("RESOLVED");
    expect(packet.instructions).toContain("old or resolved inferences are not current weaknesses");
  });
});
