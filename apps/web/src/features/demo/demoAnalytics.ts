import {
  mvpPatternNames,
  type Attempt,
  type PatternEvidence,
  type PatternEvidenceResponse,
  type StreakCalendarResponse,
} from "@practice-plus-plus/contracts";
import { problemPatterns, sampleId, shiftDate } from "./demoData";

function outcomes(attempts: Attempt[]) {
  return {
    independent: attempts.filter((item) => item.outcome === "INDEPENDENT").length,
    assisted: attempts.filter((item) => item.outcome === "ASSISTED").length,
    gaveUp: attempts.filter((item) => item.outcome === "GAVE_UP").length,
    incomplete: attempts.filter((item) => item.outcome === "INCOMPLETE").length,
  };
}

function freshOutcomes(attempts: Attempt[]) {
  const { independent, assisted, gaveUp } = outcomes(attempts);
  return { independent, assisted, gaveUp };
}

function redoEvidence(attempts: Attempt[]) {
  const counts = outcomes(attempts);
  const count = counts.independent + counts.assisted + counts.gaveUp;
  return {
    outcomes: counts,
    successRate: count ? (counts.independent + counts.assisted) / count : null,
  };
}

function assistance(attempts: Attempt[]) {
  const count = (type: Attempt["assistance"][number]["type"]) =>
    attempts.filter((item) => item.assistance.some((event) => event.type === type)).length;
  return {
    clarification: count("CLARIFICATION"),
    conceptualHint: count("CONCEPTUAL_HINT"),
    debugging: count("DEBUGGING"),
    optimization: count("OPTIMIZATION"),
    solutionReview: count("SOLUTION_REVIEW"),
  };
}

function optimality(attempts: Attempt[]) {
  return {
    optimal: attempts.filter((item) => item.optimality === "OPTIMAL").length,
    suboptimal: attempts.filter((item) => item.optimality === "SUBOPTIMAL").length,
    unknownOrOmitted: attempts.filter(
      (item) => item.optimality === null || item.optimality === "UNKNOWN",
    ).length,
  };
}

export function demoAnalytics(attempts: Attempt[], date: string): PatternEvidenceResponse {
  const confirmed = attempts.filter((item) => item.confirmedAt !== null);
  const evidence = confirmed.filter((item) => item.outcome !== "INCOMPLETE");
  const recent = evidence.filter((item) => item.practiceDate >= shiftDate(date, -6));
  const due = confirmed.filter(
    (item) =>
      item.review !== null && (item.review.manualDueDate ?? item.review.generatedDueDate) <= date,
  );
  const overdue = due.filter(
    (item) => (item.review!.manualDueDate ?? item.review!.generatedDueDate) < date,
  );
  const patterns: PatternEvidence[] = mvpPatternNames.map((patternName, index) => {
    const all = confirmed.filter((item) =>
      problemPatterns(item.problem.slug).includes(patternName),
    );
    const valid = all.filter((item) => item.outcome !== "INCOMPLETE");
    const fresh = valid.filter((item) => item.type === "FRESH").slice(-10);
    const weak = fresh.filter(
      (item) =>
        item.outcome !== "INDEPENDENT" ||
        item.confidence === "SHAKY" ||
        item.optimality === "SUBOPTIMAL",
    ).length;
    const latest = valid.at(-1)?.practiceDate ?? null;
    const exposure = recent.filter((item) =>
      problemPatterns(item.problem.slug).includes(patternName),
    ).length;
    const problems = new Map(
      valid.map((item) => [
        item.problem.id,
        {
          id: item.problem.id,
          leetcodeId: item.problem.leetcodeId,
          title: item.problem.title,
          lastAttemptAt: item.confirmedAt!,
          practiceDate: item.practiceDate,
        },
      ]),
    );
    return {
      patternId: sampleId(400 + index),
      patternName,
      problems: [...problems.values()],
      classification:
        fresh.length === 0
          ? "UNTESTED"
          : fresh.length < 5
            ? "INSUFFICIENT_EVIDENCE"
            : weak > fresh.length / 2
              ? "NEEDS_PRACTICE"
              : "NO_CURRENT_WEAKNESS_SIGNAL",
      fresh: {
        sampleCount: fresh.length,
        weightedTotal: fresh.length,
        weightedWeakSignals: weak,
        outcomes: freshOutcomes(fresh),
      },
      redo: redoEvidence(all.filter((item) => item.type === "REDO")),
      assistance: assistance(valid),
      highestConceptualHintLevel:
        Math.max(
          0,
          ...valid.flatMap((item) => item.assistance.map((event) => event.hintLevel ?? 0)),
        ) || null,
      optimality: optimality(valid),
      lastPracticed: latest,
      stale: latest !== null && latest <= shiftDate(date, -30),
      recentExposureShare: recent.length ? exposure / recent.length : null,
      overconcentrated: recent.length >= 4 && exposure > recent.length / 2,
    };
  });
  return {
    asOfPracticeDate: date,
    patterns,
    summary: {
      freshOutcomes: freshOutcomes(evidence.filter((item) => item.type === "FRESH")),
      redo: redoEvidence(confirmed.filter((item) => item.type === "REDO")),
      assistance: assistance(evidence),
      optimality: optimality(evidence),
      reviewWork: {
        overdueExactRedos: overdue.length,
        overdueTransfers: 0,
        dueTodayExactRedos: due.length - overdue.length,
        dueTodayTransfers: 0,
        overdueItems: overdue.map((item) => ({
          type: "EXACT_REDO",
          sourceAttemptId: item.id,
          dueDate: item.review!.manualDueDate ?? item.review!.generatedDueDate,
          daysOverdue: Math.round(
            (Date.parse(date) -
              Date.parse(item.review!.manualDueDate ?? item.review!.generatedDueDate)) /
              86400000,
          ),
          problem: {
            leetcodeId: item.problem.leetcodeId,
            title: item.problem.title,
            url: item.problem.url,
          },
        })),
      },
    },
  };
}

export function demoCalendar(
  attempts: Attempt[],
  date: string,
  target: number,
  month = date.slice(0, 7),
): StreakCalendarResponse {
  const counts = new Map<string, number>();
  for (const item of attempts) {
    if (item.confirmedAt && item.outcome !== "INCOMPLETE")
      counts.set(item.practiceDate, (counts.get(item.practiceDate) ?? 0) + 1);
  }
  const trackingStartDate = [...counts.keys()].sort()[0] ?? date;
  let currentStreak = 0;
  let cursor = (counts.get(date) ?? 0) >= target ? date : shiftDate(date, -1);
  while ((counts.get(cursor) ?? 0) >= (cursor === date ? target : 2)) {
    currentStreak++;
    cursor = shiftDate(cursor, -1);
  }
  const length = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0),
  ).getUTCDate();
  return {
    asOfPracticeDate: date,
    month,
    trackingStartDate,
    currentStreak,
    days: Array.from({ length }, (_, index) => {
      const day = `${month}-${String(index + 1).padStart(2, "0")}`;
      const completed = counts.get(day) ?? 0;
      const required = day === date ? target : 2;
      const untracked = day < trackingStartDate || day > date;
      return {
        date: day,
        isCurrent: day === date,
        neutralReason: null,
        requiredCount: untracked ? null : required,
        completedCount: untracked ? null : completed,
        status:
          day > date
            ? "FUTURE"
            : day < trackingStartDate
              ? "UNTRACKED"
              : completed >= required
                ? "COMPLETED"
                : day === date
                  ? "CURRENT"
                  : completed > 0
                    ? "PARTIAL"
                    : "MISSED",
      };
    }),
  };
}
