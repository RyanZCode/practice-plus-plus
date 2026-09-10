import { rankDueReviews, type ReviewCandidate } from "./rankDueReviews.js";
import {
  rankFreshCandidates,
  type FreshCandidate,
  type FreshRankingAttempt,
} from "./rankFreshCandidates.js";

export type TransferCandidate = {
  id: string;
  patternId: string;
  eligibleDate: string;
};
export type PlanSelection = {
  problemId: string;
  kind: "DIAGNOSTIC" | "FRESH" | "REDO" | "TRANSFER";
  reason: "FRESH_DIAGNOSTIC" | "FRESH_PRACTICE" | "OVERDUE_REVIEW" | "REVIEW_DUE" | "TRANSFER_DUE";
  transferId: string | null;
};

export function buildDailyPlan(input: {
  target: number;
  practiceDate: string;
  hidePaidProblems: boolean;
  candidates: readonly FreshCandidate[];
  history: readonly FreshRankingAttempt[];
  reviews: readonly (ReviewCandidate & { problemId: string })[];
  transfers: readonly TransferCandidate[];
}): PlanSelection[] {
  if (!Number.isInteger(input.target) || input.target < 1 || input.target > 10) {
    throw new RangeError("Invalid daily target.");
  }
  const fresh = rankFreshCandidates(
    input.candidates,
    input.history,
    input.practiceDate,
    input.hidePaidProblems,
  );
  const selected: PlanSelection[] = [];
  const used = new Set<string>();
  function add(item: PlanSelection) {
    if (selected.length < input.target && !used.has(item.problemId)) {
      selected.push(item);
      used.add(item.problemId);
    }
  }
  const diagnostic = fresh[0];
  if (input.target >= 2 && diagnostic !== undefined) {
    add({
      problemId: diagnostic.problemId,
      kind: "DIAGNOSTIC",
      reason: "FRESH_DIAGNOSTIC",
      transferId: null,
    });
  }
  const active = new Set(
    input.history.filter((a) => a.confirmedAt === null).map((a) => a.problemId),
  );
  const eligible = new Set(
    input.candidates
      .filter(
        (p) =>
          p.published &&
          p.availability !== "UNAVAILABLE" &&
          !(input.hidePaidProblems && p.availability === "PAID_ONLY"),
      )
      .map((p) => p.id),
  );
  const reviewsById = new Map(input.reviews.map((r) => [r.sourceAttemptId, r]));
  const reviews = rankDueReviews(input.reviews, input.practiceDate).filter((r) => {
    const review = reviewsById.get(r.sourceAttemptId)!;
    return eligible.has(review.problemId) && !active.has(review.problemId);
  });
  function addReviews(highOverdue: boolean) {
    for (const ranked of reviews) {
      const review = reviewsById.get(ranked.sourceAttemptId)!;
      if ((review.urgency === "HIGH" && ranked.dueDate < input.practiceDate) !== highOverdue)
        continue;
      add({
        problemId: review.problemId,
        kind: "REDO",
        reason: ranked.dueDate < input.practiceDate ? "OVERDUE_REVIEW" : "REVIEW_DUE",
        transferId: null,
      });
    }
  }
  addReviews(true);
  const candidates = new Map(input.candidates.map((p) => [p.id, p]));
  for (const transfer of input.transfers
    .filter((t) => t.eligibleDate <= input.practiceDate)
    .toSorted((a, b) => a.eligibleDate.localeCompare(b.eligibleDate) || a.id.localeCompare(b.id))) {
    const match = fresh.find(
      (p) =>
        !used.has(p.problemId) &&
        candidates.get(p.problemId)!.patternIds.includes(transfer.patternId),
    );
    if (match !== undefined)
      add({
        problemId: match.problemId,
        kind: "TRANSFER",
        reason: "TRANSFER_DUE",
        transferId: transfer.id,
      });
  }
  addReviews(false);
  for (const candidate of fresh) {
    add({
      problemId: candidate.problemId,
      kind: "FRESH",
      reason: "FRESH_PRACTICE",
      transferId: null,
    });
  }
  return selected;
}
