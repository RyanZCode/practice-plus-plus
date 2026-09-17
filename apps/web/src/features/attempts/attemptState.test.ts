import { describe, expect, it } from "vitest";
import type { Attempt } from "@practice-plus-plus/contracts";
import { eligibleProblems, remainingSeconds } from "./attemptState";

const attempt: Attempt = {
  review: null,
  id: "d3b65a55-1a50-43e1-82e0-e23a263925a5",
  type: "FRESH",
  practiceDate: "2026-09-06",
  startedAt: "2026-09-07T03:00:00.000Z",
  timerSkippedAt: null,
  confirmedAt: null,
  solutionReviewedAt: null,
  outcome: null,
  confidence: null,
  optimality: null,
  timeSpentSeconds: null,
  approach: null,
  notes: null,
  reproducedFromMemory: null,
  assistance: [],
  problem: {
    id: "6931f7d2-86fc-43de-b7db-dcc636528fc1",
    leetcodeId: 1,
    title: "Two Sum",
    slug: "two-sum",
    url: "https://leetcode.com/problems/two-sum/",
    difficulty: "EASY",
    availability: "AVAILABLE",
  },
};
describe("attempt timer", () => {
  it("starts at thirty minutes and derives elapsed time after refresh or a background tab", () => {
    const start = Date.parse(attempt.startedAt);
    expect(remainingSeconds(attempt, start)).toBe(1800);
    expect(remainingSeconds(attempt, start + 65000)).toBe(1735);
    expect(remainingSeconds(attempt, start + 1800000)).toBe(0);
    expect(remainingSeconds(attempt, start + 3600000)).toBe(0);
    expect(attempt.timerSkippedAt).toBeNull();
  });
  it("keeps a skipped timer at zero without changing the attempt", () => {
    const skipped = { ...attempt, timerSkippedAt: attempt.startedAt };
    expect(remainingSeconds(skipped, Date.parse(attempt.startedAt))).toBe(0);
    expect(skipped.type).toBe("FRESH");
  });
  it("keeps the remaining time fixed while paused", () => {
    const paused = {
      ...attempt,
      timerEndsAt: "2026-09-07T03:30:00.000Z",
      timerPausedAt: "2026-09-07T03:10:00.000Z",
    };
    expect(remainingSeconds(paused, Date.parse("2026-09-07T04:00:00.000Z"))).toBe(1200);
  });
});
it("allows paid problems unless filtered and always excludes unavailable ones", () => {
  const paid = { ...attempt.problem, availability: "PAID_ONLY" as const };
  const unavailable = { ...attempt.problem, availability: "UNAVAILABLE" as const };
  expect(eligibleProblems([attempt.problem, paid, unavailable], false)).toEqual([
    attempt.problem,
    paid,
  ]);
  expect(eligibleProblems([attempt.problem, paid, unavailable], true)).toEqual([attempt.problem]);
});
