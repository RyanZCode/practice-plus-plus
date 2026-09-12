import type { Attempt, CatalogProblem, FreshRankingReason } from "@practice-plus-plus/contracts";

export type FreshCandidate = Pick<
  CatalogProblem,
  "id" | "leetcodeId" | "difficulty" | "availability"
> & {
  published: boolean;
  patternIds: readonly string[];
};

export type FreshRankingAttempt = Pick<
  Attempt,
  | "id"
  | "type"
  | "practiceDate"
  | "startedAt"
  | "confirmedAt"
  | "outcome"
  | "confidence"
  | "optimality"
> & {
  problemId: string;
  patternIds: readonly string[];
};

export type RankedFreshCandidate = {
  problemId: string;
  reasons: FreshRankingReason[];
};

export function rankFreshCandidates(
  candidates: readonly FreshCandidate[],
  history: readonly FreshRankingAttempt[],
  practiceDate: string,
  hidePaidProblems: boolean,
): RankedFreshCandidate[] {
  const attempted = new Set(history.map((attempt) => attempt.problemId));
  const patterns = new Map(
    getPatternEvidence(
      [...new Set(candidates.flatMap((candidate) => candidate.patternIds))],
      history,
      practiceDate,
    ).map((pattern) => [pattern.patternId, pattern]),
  );
  const difficultyOrder = { EASY: 0, MEDIUM: 1, HARD: 2 };

  return candidates
    .filter(
      (candidate) =>
        candidate.published &&
        candidate.availability !== "UNAVAILABLE" &&
        !(hidePaidProblems && candidate.availability === "PAID_ONLY") &&
        !attempted.has(candidate.id),
    )
    .map((candidate) => {
      const reasons = new Set<FreshRankingReason["code"]>();
      let totalPriority = 0;
      for (const patternId of candidate.patternIds) {
        const pattern = patterns.get(patternId)!;
        totalPriority += pattern.priority;
        for (const reason of pattern.reasons) reasons.add(reason.code);
      }
      return {
        candidate,
        priority: totalPriority / candidate.patternIds.length,
        reasons: [...reasons].sort().map((code) => ({ code })),
      };
    })
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        difficultyOrder[a.candidate.difficulty] - difficultyOrder[b.candidate.difficulty] ||
        a.candidate.leetcodeId - b.candidate.leetcodeId,
    )
    .map(({ candidate, reasons }) => ({ problemId: candidate.id, reasons }));
}

export function getPatternEvidence(
  patternIds: readonly string[],
  history: readonly FreshRankingAttempt[],
  practiceDate: string,
) {
  const today = calendarDay(practiceDate);

  const evidence = history
    .filter((attempt) => {
      const day = calendarDay(attempt.practiceDate);
      return (
        day <= today &&
        attempt.confirmedAt !== null &&
        attempt.outcome !== null &&
        attempt.outcome !== "INCOMPLETE"
      );
    })
    .toSorted((a, b) => b.startedAt.localeCompare(a.startedAt) || a.id.localeCompare(b.id));
  const recent = evidence.filter((attempt) => calendarDay(attempt.practiceDate) >= today - 6);
  const exposure = new Map<string, number>();
  for (const attempt of recent) {
    for (const patternId of attempt.patternIds) {
      exposure.set(patternId, (exposure.get(patternId) ?? 0) + contribution(attempt));
    }
  }

  return patternIds.map((patternId) => {
    const attempts = evidence.filter((attempt) => attempt.patternIds.includes(patternId));
    const fresh = attempts.filter((attempt) => attempt.type === "FRESH").slice(0, 5);
    const total = fresh.reduce((sum, attempt) => sum + contribution(attempt), 0);
    const weak = fresh
      .filter(
        (attempt) =>
          attempt.outcome === "ASSISTED" ||
          attempt.outcome === "GAVE_UP" ||
          attempt.confidence === "SHAKY" ||
          attempt.optimality === "SUBOPTIMAL",
      )
      .reduce((sum, attempt) => sum + contribution(attempt), 0);
    const lastDay = attempts.reduce(
      (latest, attempt) => Math.max(latest, calendarDay(attempt.practiceDate)),
      -Infinity,
    );
    const code: FreshRankingReason["code"] =
      fresh.length === 0
        ? "UNTESTED_PATTERN"
        : fresh.length < 3
          ? "LIMITED_PATTERN_EVIDENCE"
          : weak * 2 > total
            ? "WEAK_PATTERN"
            : today - lastDay >= 30
              ? "STALE_PATTERN"
              : "FRESH_PRACTICE";
    let priority =
      fresh.length < 3 ? 0 : code === "WEAK_PATTERN" ? 1 : code === "STALE_PATTERN" ? 2 : 3;
    const patternReasons: FreshRankingReason[] = [{ code }];
    if (recent.length >= 4 && (exposure.get(patternId) ?? 0) * 2 > recent.length * 6) {
      priority = Math.min(priority + 1, 3);
      patternReasons.push({ code: "RECENT_PATTERN_CONCENTRATION" });
    }
    const lastPracticed =
      attempts
        .map((attempt) => attempt.practiceDate)
        .sort()
        .at(-1) ?? null;
    return {
      patternId,
      priority,
      reasons: patternReasons,
      freshSamples: fresh.length,
      independentSamples: fresh.filter((attempt) => attempt.outcome === "INDEPENDENT").length,
      assistedSamples: fresh.filter((attempt) => attempt.outcome === "ASSISTED").length,
      gaveUpSamples: fresh.filter((attempt) => attempt.outcome === "GAVE_UP").length,
      lastPracticed,
      stale: lastPracticed !== null && today - calendarDay(lastPracticed) >= 30,
    };
  });
}

function contribution(attempt: FreshRankingAttempt): number {
  // Six units split exactly across the catalog's one to three tags.
  return 6 / attempt.patternIds.length;
}

function calendarDay(value: string): number {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new RangeError("Invalid attempt or practice date.");
  }
  return date.getTime() / 86_400_000;
}
