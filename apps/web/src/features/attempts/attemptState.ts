import {
  attemptTimerSeconds,
  type Attempt,
  type CatalogProblem,
} from "@practice-plus-plus/contracts";

export function remainingSeconds(attempt: Attempt, now: number): number {
  if (attempt.timerSkippedAt !== null) return 0;
  const endsAt =
    attempt.timerEndsAt === undefined
      ? Date.parse(attempt.startedAt) + attemptTimerSeconds * 1000
      : Date.parse(attempt.timerEndsAt);
  const effectiveNow =
    attempt.timerPausedAt === undefined || attempt.timerPausedAt === null
      ? now
      : Date.parse(attempt.timerPausedAt);
  return Math.max(0, Math.ceil((endsAt - effectiveNow) / 1000));
}

export function eligibleProblems(problems: CatalogProblem[], hidePaid: boolean): CatalogProblem[] {
  return problems.filter(
    (problem) =>
      problem.availability !== "UNAVAILABLE" && (!hidePaid || problem.availability !== "PAID_ONLY"),
  );
}
