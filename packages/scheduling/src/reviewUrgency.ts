import type { Attempt } from "@practice-plus-plus/contracts";

export type ReviewUrgency = "LOW" | "MEDIUM" | "HIGH";

type ReviewAttempt = Pick<
  Attempt,
  "confirmedAt" | "outcome" | "confidence" | "optimality" | "assistance"
>;

export function deriveReviewUrgency(attempt: ReviewAttempt): ReviewUrgency | null {
  if (attempt.confirmedAt === null || attempt.outcome === null) return null;

  switch (attempt.outcome) {
    case "INCOMPLETE":
    case "INDEPENDENT":
      return null;
    case "GAVE_UP":
      return "HIGH";
    case "ASSISTED":
      return "MEDIUM";
  }
}
