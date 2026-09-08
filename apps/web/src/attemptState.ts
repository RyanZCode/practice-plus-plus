import {
  attemptTimerSeconds,
  type Attempt,
  type CatalogProblem,
} from "@practice-plus-plus/contracts";

export function remainingSeconds(attempt: Attempt, now: number): number {
  if (attempt.timerSkippedAt !== null) return 0;
  return Math.max(
    0,
    Math.min(
      attemptTimerSeconds,
      Math.ceil((Date.parse(attempt.startedAt) + attemptTimerSeconds * 1000 - now) / 1000),
    ),
  );
}

export function eligibleProblems(problems: CatalogProblem[], hidePaid: boolean): CatalogProblem[] {
  return problems.filter(
    (problem) =>
      problem.availability !== "UNAVAILABLE" && (!hidePaid || problem.availability !== "PAID_ONLY"),
  );
}
