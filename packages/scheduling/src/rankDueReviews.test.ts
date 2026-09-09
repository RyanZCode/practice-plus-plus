import { reviewRankingReasonSchema } from "@practice-plus-plus/contracts";
import { describe, expect, it } from "vitest";
import { rankDueReviews, type ReviewCandidate } from "./index.js";

function review(
  sourceAttemptId: string,
  generatedDueDate = "2026-09-09",
  urgency: ReviewCandidate["urgency"] = "MEDIUM",
  manualDueDate: string | null = null,
): ReviewCandidate {
  return { sourceAttemptId, generatedDueDate, urgency, manualDueDate };
}

describe("rankDueReviews", () => {
  it("ranks oldest first, then urgency, then source attempt ID regardless of input order", () => {
    const reviews = [
      review("b"),
      review("low", "2026-09-09", "LOW"),
      review("a"),
      review("high", "2026-09-09", "HIGH"),
      review("old", "2026-09-08", "LOW"),
    ];
    const before = reviews.map((item) => ({ ...item }));
    const ranked = rankDueReviews(reviews, "2026-09-09");
    expect(ranked.map((item) => item.sourceAttemptId)).toEqual(["old", "high", "a", "b", "low"]);
    expect(rankDueReviews(reviews.toReversed(), "2026-09-09")).toEqual(ranked);
    expect(reviews).toEqual(before);
  });

  it("uses overrides for eligibility and ordering and excludes future reviews", () => {
    const ranked = rankDueReviews(
      [
        review("postponed", "2026-09-01", "HIGH", "2026-09-10"),
        review("advanced", "2026-09-20", "LOW", "2026-09-07"),
        review("future", "2026-09-10"),
        review("today"),
      ],
      "2026-09-09",
    );
    expect(ranked).toEqual([
      {
        sourceAttemptId: "advanced",
        dueDate: "2026-09-07",
        reasons: [
          { code: "OVERDUE_REVIEW", daysOverdue: 2 },
          { code: "REVIEW_URGENCY", urgency: "LOW" },
        ],
      },
      {
        sourceAttemptId: "today",
        dueDate: "2026-09-09",
        reasons: [{ code: "REVIEW_DUE_TODAY" }, { code: "REVIEW_URGENCY", urgency: "MEDIUM" }],
      },
    ]);
    for (const item of ranked) {
      for (const reason of item.reasons)
        expect(reviewRankingReasonSchema.parse(reason)).toEqual(reason);
    }
    expect(rankDueReviews([], "2026-09-09")).toEqual([]);
  });

  it.each([
    ["2028-02-28", "2028-03-01", 2],
    ["2026-12-31", "2027-01-01", 1],
    ["2026-03-07", "2026-03-09", 2],
    ["2026-10-31", "2026-11-02", 2],
  ])("counts calendar days from %s through %s", (due, today, daysOverdue) => {
    expect(rankDueReviews([review("a", due)], today)[0]?.reasons[0]).toEqual({
      code: "OVERDUE_REVIEW",
      daysOverdue,
    });
  });

  it.each(["invalid", "2026-02-29", "2026-9-9"])("rejects invalid dates: %s", (date) => {
    expect(() => rankDueReviews([], date)).toThrow(RangeError);
    expect(() => rankDueReviews([review("a", date)], "2026-09-09")).toThrow(RangeError);
    expect(() => rankDueReviews([review("a", "2026-09-09", "LOW", date)], "2026-09-09")).toThrow(
      RangeError,
    );
  });
});
