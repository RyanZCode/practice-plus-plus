import type { Attempt } from "@practice-plus-plus/contracts";

export type ReviewUrgency = "LOW" | "MEDIUM" | "HIGH";

type ReviewAttempt = Pick<
  Attempt,
  "confirmedAt" | "outcome" | "confidence" | "optimality" | "assistance"
>;

export function deriveReviewUrgency(attempt: ReviewAttempt): ReviewUrgency | null {
  if (attempt.confirmedAt === null || attempt.outcome === null) return null;

  switch (attempt.outcome) {
    case "INDEPENDENT":
      return null;
    case "GAVE_UP":
    case "INCOMPLETE":
      return "HIGH";
    case "ASSISTED":
      if (
        attempt.confidence === "SHAKY" ||
        attempt.assistance.some((event) => event.type === "CONCEPTUAL_HINT")
      ) {
        return "HIGH";
      }
      if (
        attempt.confidence === "CONFIDENT" &&
        attempt.optimality === "OPTIMAL" &&
        attempt.assistance.length > 0 &&
        attempt.assistance.every(
          (event) => event.type === "CLARIFICATION" || event.type === "OPTIMIZATION",
        )
      ) {
        return "LOW";
      }
      return "MEDIUM";
  }
}
