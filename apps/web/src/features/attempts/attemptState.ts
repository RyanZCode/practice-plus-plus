import { attemptTimerSeconds, type Attempt } from "@practice-plus-plus/contracts";

export function formatRemainingSeconds(seconds: number): string {
  const bounded = Math.max(0, seconds);
  return `${Math.floor(bounded / 60)}:${(bounded % 60).toString().padStart(2, "0")}`;
}

export function attemptDocumentTitle(attempt: Attempt | null, seconds: number): string {
  if (attempt === null || attempt.outcome !== null || attempt.timerSkippedAt !== null) {
    return "Practice++";
  }
  const status =
    seconds === 0
      ? "Time up"
      : attempt.timerPausedAt == null
        ? formatRemainingSeconds(seconds)
        : `Paused ${formatRemainingSeconds(seconds)}`;
  return `${status} · ${attempt.problem.title} | Practice++`;
}

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
