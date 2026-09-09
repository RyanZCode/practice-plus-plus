import type { ReviewRankingReason } from "@practice-plus-plus/contracts";
import type { ReviewUrgency } from "./reviewUrgency.js";

export type ReviewCandidate = {
  sourceAttemptId: string;
  generatedDueDate: string;
  manualDueDate: string | null;
  urgency: ReviewUrgency;
};

export type RankedReview = {
  sourceAttemptId: string;
  dueDate: string;
  reasons: ReviewRankingReason[];
};

export function rankDueReviews(
  reviews: readonly ReviewCandidate[],
  practiceDate: string,
): RankedReview[] {
  const today = calendarDay(practiceDate);
  const urgencyOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };

  return reviews
    .map((review) => {
      const dueDate = review.manualDueDate ?? review.generatedDueDate;
      return { ...review, dueDate, daysOverdue: today - calendarDay(dueDate) };
    })
    .filter((review) => review.daysOverdue >= 0)
    .sort(
      (a, b) =>
        b.daysOverdue - a.daysOverdue ||
        urgencyOrder[a.urgency] - urgencyOrder[b.urgency] ||
        (a.sourceAttemptId < b.sourceAttemptId
          ? -1
          : a.sourceAttemptId > b.sourceAttemptId
            ? 1
            : 0),
    )
    .map(({ sourceAttemptId, dueDate, daysOverdue, urgency }) => ({
      sourceAttemptId,
      dueDate,
      reasons: [
        daysOverdue > 0 ? { code: "OVERDUE_REVIEW", daysOverdue } : { code: "REVIEW_DUE_TODAY" },
        { code: "REVIEW_URGENCY", urgency },
      ],
    }));
}

function calendarDay(value: string): number {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new RangeError("Invalid review or practice date.");
  }
  return date.getTime() / 86_400_000;
}
