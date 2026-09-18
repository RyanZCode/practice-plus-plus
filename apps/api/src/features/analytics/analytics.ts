import {
  patternEvidenceResponseSchema,
  streakCalendarQuerySchema,
  type PatternEvidenceResponse,
} from "@practice-plus-plus/contracts";
import { Router } from "express";
import { practiceDateFor } from "../daily-plan/dailyPlan.js";
import { HttpError } from "../../shared/errors.js";
import type { PrismaClient } from "../../shared/generated/prisma/client.js";
import { getApplicationProfile } from "../account/profile.js";
import { createPrismaStreakStore, type StreakStore } from "./streak.js";

type AnalyticsAttempt = {
  id: string;
  type: "FRESH" | "REDO";
  practiceDate: string;
  startedAt: string;
  outcome: "INDEPENDENT" | "ASSISTED" | "GAVE_UP" | "INCOMPLETE";
  confidence: "CONFIDENT" | "SHAKY" | null;
  optimality: "OPTIMAL" | "SUBOPTIMAL" | "UNKNOWN" | null;
  patternIds: readonly string[];
  assistance: readonly { type: string; hintLevel: number | null }[];
};

type AnalyticsPattern = { id: string; name: string };
type AnalyticsDueWork = {
  exactRedos: readonly {
    sourceAttemptId: string;
    dueDate: string;
    problem: { leetcodeId: number; title: string; url: string };
  }[];
  transfers: readonly {
    id: string;
    sourceAttemptId: string;
    dueDate: string;
    patternName: string;
    sourceProblemTitle: string;
  }[];
};

export interface AnalyticsStore {
  patternEvidence(userProfileId: string, now: Date): Promise<PatternEvidenceResponse>;
  streak?: StreakStore["calendar"];
}

export function aggregatePatternEvidence(
  patterns: readonly AnalyticsPattern[],
  attempts: readonly AnalyticsAttempt[],
  asOfPracticeDate: string,
  dueWork: AnalyticsDueWork = { exactRedos: [], transfers: [] },
): PatternEvidenceResponse {
  const asOfDay = calendarDay(asOfPracticeDate);
  const eligible = attempts.filter(
    (attempt) => calendarDay(attempt.practiceDate) <= asOfDay && attempt.patternIds.length > 0,
  );
  const learningAttempts = eligible.filter((attempt) => attempt.outcome !== "INCOMPLETE");
  const recent = learningAttempts.filter(
    (attempt) => calendarDay(attempt.practiceDate) >= asOfDay - 6,
  );
  const freshAttempts = learningAttempts.filter((attempt) => attempt.type === "FRESH");
  const redoAttempts = eligible.filter((attempt) => attempt.type === "REDO");
  const knownRedoAttempts = redoAttempts.filter((attempt) => attempt.outcome !== "INCOMPLETE");
  const redoSuccesses = knownRedoAttempts.filter(
    (attempt) => attempt.outcome === "INDEPENDENT" || attempt.outcome === "ASSISTED",
  ).length;

  return patternEvidenceResponseSchema.parse({
    asOfPracticeDate,
    summary: {
      freshOutcomes: countLearningOutcomes(freshAttempts),
      redo: {
        outcomes: countOutcomes(redoAttempts),
        successRate:
          knownRedoAttempts.length === 0 ? null : redoSuccesses / knownRedoAttempts.length,
      },
      assistance: countAssistance(
        learningAttempts.filter((attempt) => attempt.assistance.length > 0),
      ),
      optimality: countOptimality(learningAttempts),
      reviewWork: {
        overdueExactRedos: countDueBefore(dueWork.exactRedos, asOfPracticeDate),
        overdueTransfers: countDueBefore(dueWork.transfers, asOfPracticeDate),
        dueTodayExactRedos: countDueOn(dueWork.exactRedos, asOfPracticeDate),
        dueTodayTransfers: countDueOn(dueWork.transfers, asOfPracticeDate),
        overdueItems: overdueItems(dueWork, asOfPracticeDate),
      },
    },
    patterns: patterns.map((pattern) => {
      const involving = learningAttempts.filter((attempt) =>
        attempt.patternIds.includes(pattern.id),
      );
      const fresh = involving
        .filter((attempt) => attempt.type === "FRESH")
        .toSorted((a, b) => b.startedAt.localeCompare(a.startedAt) || a.id.localeCompare(b.id))
        .slice(0, 10);
      const redo = eligible.filter(
        (attempt) => attempt.type === "REDO" && attempt.patternIds.includes(pattern.id),
      );
      const weightedTotal = sumContributions(fresh);
      const weightedWeakSignals = sumContributions(fresh.filter(isWeakSignal));
      const recentExposure = sumContributions(
        recent.filter((attempt) => attempt.patternIds.includes(pattern.id)),
      );
      const recentExposureShare = recent.length === 0 ? null : recentExposure / recent.length;
      const lastPracticed =
        involving
          .map((attempt) => attempt.practiceDate)
          .sort()
          .at(-1) ?? null;
      const assistanceAttempts = involving.filter((attempt) => attempt.assistance.length > 0);
      const knownRedo = redo.filter((attempt) => attempt.outcome !== "INCOMPLETE");
      const redoSuccesses = knownRedo.filter(
        (attempt) => attempt.outcome === "INDEPENDENT" || attempt.outcome === "ASSISTED",
      ).length;
      const classification =
        fresh.length === 0
          ? "UNTESTED"
          : fresh.length < 5
            ? "INSUFFICIENT_EVIDENCE"
            : weightedWeakSignals * 2 > weightedTotal
              ? "NEEDS_PRACTICE"
              : "NO_CURRENT_WEAKNESS_SIGNAL";

      return {
        patternId: pattern.id,
        patternName: pattern.name,
        classification,
        fresh: {
          sampleCount: fresh.length,
          weightedTotal,
          weightedWeakSignals,
          outcomes: countLearningOutcomes(fresh),
        },
        redo: {
          outcomes: countOutcomes(redo),
          successRate: knownRedo.length === 0 ? null : redoSuccesses / knownRedo.length,
        },
        assistance: countAssistance(assistanceAttempts),
        highestConceptualHintLevel:
          involving
            .flatMap((attempt) => attempt.assistance)
            .filter((event) => event.type === "CONCEPTUAL_HINT")
            .map((event) => event.hintLevel ?? 0)
            .sort((a, b) => b - a)[0] || null,
        optimality: countOptimality(involving),
        lastPracticed,
        stale: lastPracticed !== null && asOfDay - calendarDay(lastPracticed) >= 30,
        recentExposureShare,
        overconcentrated:
          recent.length >= 4 && recentExposureShare !== null && recentExposureShare > 0.5,
      };
    }),
  });
}

export function createPrismaAnalyticsStore(client: PrismaClient): AnalyticsStore {
  const streakStore = createPrismaStreakStore(client);
  return {
    async patternEvidence(userProfileId, now) {
      const [settings, patterns, attempts, reviews, transfers] = await client.$transaction([
        client.practiceSettings.findUnique({
          where: { userProfileId },
          select: { timeZone: true, resetMinutes: true },
        }),
        client.pattern.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
        client.attempt.findMany({
          where: { userProfileId, confirmedAt: { not: null }, outcome: { not: null } },
          select: {
            id: true,
            type: true,
            practiceDate: true,
            startedAt: true,
            outcome: true,
            confidence: true,
            optimality: true,
            assistance: { select: { type: true, hintLevel: true } },
            problem: { select: { problemPatterns: { select: { patternId: true } } } },
          },
        }),
        client.reviewObligation.findMany({
          where: { resolvedAt: null, sourceAttempt: { userProfileId } },
          select: {
            sourceAttemptId: true,
            generatedDueDate: true,
            manualDueDate: true,
            sourceAttempt: {
              select: {
                problem: { select: { leetcodeId: true, title: true, url: true } },
              },
            },
          },
        }),
        client.transferObligation.findMany({
          where: { resolvedAt: null, sourceAttempt: { userProfileId } },
          select: {
            id: true,
            sourceAttemptId: true,
            generatedEligibleDate: true,
            manualEligibleDate: true,
            pattern: { select: { name: true } },
            sourceAttempt: { select: { problem: { select: { title: true } } } },
          },
        }),
      ]);
      if (settings === null)
        throw new HttpError(409, "Save practice settings before viewing analytics.");
      return aggregatePatternEvidence(
        patterns,
        attempts.map((attempt) => ({
          ...attempt,
          outcome: attempt.outcome!,
          practiceDate: date(attempt.practiceDate),
          startedAt: attempt.startedAt.toISOString(),
          patternIds: attempt.problem.problemPatterns.map((tag) => tag.patternId),
        })),
        practiceDateFor(now, settings),
        {
          exactRedos: reviews.map((review) => ({
            sourceAttemptId: review.sourceAttemptId,
            dueDate: date(review.manualDueDate ?? review.generatedDueDate),
            problem: review.sourceAttempt.problem,
          })),
          transfers: transfers.map((transfer) => ({
            id: transfer.id,
            sourceAttemptId: transfer.sourceAttemptId,
            dueDate: date(transfer.manualEligibleDate ?? transfer.generatedEligibleDate),
            patternName: transfer.pattern.name,
            sourceProblemTitle: transfer.sourceAttempt.problem.title,
          })),
        },
      );
    },
    streak: streakStore.calendar,
  };
}

export function createAnalyticsRouter(store: AnalyticsStore, clock = () => new Date()): Router {
  const router = Router();
  router.get("/patterns", async (request, response) => {
    response.json(await store.patternEvidence(getApplicationProfile(request).id, clock()));
  });
  const loadStreak = store.streak;
  if (loadStreak !== undefined) {
    router.get("/streak", async (request, response) => {
      const parsed = streakCalendarQuerySchema.safeParse(request.query);
      if (!parsed.success) throw new HttpError(400, "Invalid streak calendar month.");
      response.json(
        await loadStreak(getApplicationProfile(request).id, clock(), parsed.data.month),
      );
    });
  }
  return router;
}

function isWeakSignal(attempt: AnalyticsAttempt) {
  return (
    attempt.outcome === "ASSISTED" ||
    attempt.outcome === "GAVE_UP" ||
    attempt.confidence === "SHAKY" ||
    attempt.optimality === "SUBOPTIMAL"
  );
}

function contribution(attempt: AnalyticsAttempt) {
  return 1 / attempt.patternIds.length;
}

function sumContributions(attempts: readonly AnalyticsAttempt[]) {
  return attempts.reduce((total, attempt) => total + contribution(attempt), 0);
}

function countOutcomes(attempts: readonly AnalyticsAttempt[]) {
  return {
    independent: attempts.filter((attempt) => attempt.outcome === "INDEPENDENT").length,
    assisted: attempts.filter((attempt) => attempt.outcome === "ASSISTED").length,
    gaveUp: attempts.filter((attempt) => attempt.outcome === "GAVE_UP").length,
    incomplete: attempts.filter((attempt) => attempt.outcome === "INCOMPLETE").length,
  };
}

function countLearningOutcomes(attempts: readonly AnalyticsAttempt[]) {
  const outcomes = countOutcomes(attempts);
  return {
    independent: outcomes.independent,
    assisted: outcomes.assisted,
    gaveUp: outcomes.gaveUp,
  };
}

function countAssistance(attempts: readonly AnalyticsAttempt[]) {
  const count = (type: string) =>
    attempts.filter((attempt) => attempt.assistance.some((event) => event.type === type)).length;
  return {
    clarification: count("CLARIFICATION"),
    conceptualHint: count("CONCEPTUAL_HINT"),
    debugging: count("DEBUGGING"),
    optimization: count("OPTIMIZATION"),
    solutionReview: count("SOLUTION_REVIEW"),
  };
}

function countOptimality(attempts: readonly AnalyticsAttempt[]) {
  return {
    optimal: attempts.filter((attempt) => attempt.optimality === "OPTIMAL").length,
    suboptimal: attempts.filter((attempt) => attempt.optimality === "SUBOPTIMAL").length,
    unknownOrOmitted: attempts.filter(
      (attempt) => attempt.optimality === null || attempt.optimality === "UNKNOWN",
    ).length,
  };
}

function countDueBefore(items: readonly { dueDate: string }[], practiceDate: string) {
  return items.filter((item) => calendarDay(item.dueDate) < calendarDay(practiceDate)).length;
}

function countDueOn(items: readonly { dueDate: string }[], practiceDate: string) {
  return items.filter((item) => item.dueDate === practiceDate).length;
}

function overdueItems(dueWork: AnalyticsDueWork, practiceDate: string) {
  const practiceDay = calendarDay(practiceDate);
  return [
    ...dueWork.exactRedos.map((item) => ({
      type: "EXACT_REDO" as const,
      sourceAttemptId: item.sourceAttemptId,
      dueDate: item.dueDate,
      daysOverdue: practiceDay - calendarDay(item.dueDate),
      problem: item.problem,
    })),
    ...dueWork.transfers.map((item) => ({
      type: "TRANSFER" as const,
      transferId: item.id,
      sourceAttemptId: item.sourceAttemptId,
      dueDate: item.dueDate,
      daysOverdue: practiceDay - calendarDay(item.dueDate),
      patternName: item.patternName,
      sourceProblemTitle: item.sourceProblemTitle,
    })),
  ]
    .filter((item) => item.daysOverdue > 0)
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate));
}

function date(value: Date) {
  return value.toISOString().slice(0, 10);
}

function calendarDay(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || parsed.toISOString().slice(0, 10) !== value)
    throw new RangeError("Invalid practice date.");
  return parsed.getTime() / 86_400_000;
}
