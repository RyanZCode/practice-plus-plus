import { describe, expect, it } from "vitest";
import { buildDailyPlan } from "./buildDailyPlan.js";
import type { FreshCandidate, FreshRankingAttempt } from "./rankFreshCandidates.js";

const candidate = (id: string, leetcodeId: number, patternIds = ["a"]): FreshCandidate => ({
  id,
  leetcodeId,
  difficulty: "EASY",
  availability: "AVAILABLE",
  published: true,
  patternIds,
});
const history = (
  problemId: string,
  confirmedAt: string | null = "2026-09-01T12:00:00Z",
): FreshRankingAttempt => ({
  id: problemId,
  problemId,
  type: "FRESH",
  practiceDate: "2026-09-01",
  startedAt: "2026-09-01T11:00:00Z",
  confirmedAt,
  outcome: confirmedAt === null ? null : "ASSISTED",
  confidence: null,
  optimality: null,
  patternIds: ["a"],
});
const input = {
  target: 5,
  practiceDate: "2026-09-09",
  hidePaidProblems: false,
  candidates: [
    candidate("fresh1", 1),
    candidate("fresh2", 2),
    candidate("fresh3", 3),
    candidate("redo1", 4),
    candidate("redo2", 5),
  ],
  history: [history("redo1"), history("redo2")],
  reviews: [
    {
      sourceAttemptId: "r1",
      problemId: "redo1",
      urgency: "HIGH" as const,
      generatedDueDate: "2026-09-08",
      manualDueDate: null,
    },
    {
      sourceAttemptId: "r2",
      problemId: "redo2",
      urgency: "LOW" as const,
      generatedDueDate: "2026-09-01",
      manualDueDate: null,
    },
  ],
  transfers: [{ id: "t1", patternId: "a", eligibleDate: "2026-09-09" }],
};

describe("daily plan assembly", () => {
  it("uses a preferred fresh order without changing plan capacity", () => {
    const result = buildDailyPlan({
      ...input,
      target: 2,
      reviews: [],
      transfers: [],
      freshProblemIds: ["fresh2", "fresh1"],
    });
    expect(result.map((item) => item.problemId)).toEqual(["fresh2", "fresh1"]);
    expect(result[0]?.kind).toBe("DIAGNOSTIC");
  });
  it("reserves a diagnostic and fills in approved cross-task order", () => {
    expect(buildDailyPlan(input).map((p) => [p.problemId, p.kind])).toEqual([
      ["fresh1", "DIAGNOSTIC"],
      ["redo1", "REDO"],
      ["fresh2", "TRANSFER"],
      ["redo2", "REDO"],
      ["fresh3", "FRESH"],
    ]);
  });
  it("uses overall priority for target one", () => {
    expect(buildDailyPlan({ ...input, target: 1 })[0]?.problemId).toBe("redo1");
    expect(buildDailyPlan({ ...input, target: 1, reviews: input.reviews.slice(1) })[0]?.kind).toBe(
      "TRANSFER",
    );
    expect(
      buildDailyPlan({ ...input, target: 1, transfers: [], reviews: input.reviews.slice(1) })[0]
        ?.problemId,
    ).toBe("redo2");
  });
  it("never exceeds capacity or duplicates problems and leaves overflow unchanged", () => {
    const before = JSON.stringify(input);
    for (let target = 1; target <= 10; target++) {
      const plan = buildDailyPlan({ ...input, target });
      expect(plan.length).toBeLessThanOrEqual(target);
      expect(new Set(plan.map((p) => p.problemId)).size).toBe(plan.length);
    }
    expect(JSON.stringify(input)).toBe(before);
    expect(buildDailyPlan({ ...input, target: 2 }).map((p) => p.problemId)).toEqual([
      "fresh1",
      "redo1",
    ]);
  });
  it("keeps the sole fresh match as the reserved diagnostic", () => {
    expect(
      buildDailyPlan({ ...input, candidates: [candidate("fresh1", 1)] }).map((p) => p.kind),
    ).toEqual(["DIAGNOSTIC"]);
  });
  it("uses all capacity for reviews when no diagnostic exists", () => {
    expect(
      buildDailyPlan({ ...input, candidates: input.candidates.slice(3), target: 2 }).map(
        (p) => p.problemId,
      ),
    ).toEqual(["redo1", "redo2"]);
  });
  it("excludes active, unavailable, unpublished and hidden paid problems", () => {
    const candidates = input.candidates.map((p, i) => ({
      ...p,
      published: i !== 0,
      availability:
        i === 1 ? ("UNAVAILABLE" as const) : i === 2 ? ("PAID_ONLY" as const) : p.availability,
    }));
    const plan = buildDailyPlan({
      ...input,
      candidates,
      hidePaidProblems: true,
      history: [...input.history, history("redo1", null)],
    });
    expect(plan.map((p) => p.problemId)).toEqual(["redo2"]);
  });
  it("honors future overrides and unmatched transfers", () => {
    const plan = buildDailyPlan({
      ...input,
      target: 2,
      reviews: input.reviews.map((r) => ({ ...r, manualDueDate: "2026-09-10" })),
      transfers: [{ id: "t", patternId: "missing", eligibleDate: "2026-09-01" }],
    });
    expect(plan.map((p) => p.kind)).toEqual(["DIAGNOSTIC", "FRESH"]);
  });
  it("orders transfers deterministically and ignores future transfers", () => {
    const transfers = [
      { id: "z", patternId: "a", eligibleDate: "2026-09-09" },
      { id: "a", patternId: "a", eligibleDate: "2026-09-09" },
      { id: "future", patternId: "a", eligibleDate: "2026-09-10" },
    ];
    const plan = buildDailyPlan({ ...input, target: 3, reviews: [], transfers });
    expect(plan.map((p) => p.transferId)).toEqual([null, "a", "z"]);
    expect(
      buildDailyPlan({
        ...input,
        target: 3,
        reviews: [],
        transfers: transfers.toReversed(),
        candidates: input.candidates.toReversed(),
      }),
    ).toEqual(plan);
  });
  it("rejects invalid targets and handles an empty catalog", () => {
    for (const target of [0, 11, 1.5])
      expect(() => buildDailyPlan({ ...input, target })).toThrow(RangeError);
    expect(buildDailyPlan({ ...input, candidates: [] })).toEqual([]);
  });
});
