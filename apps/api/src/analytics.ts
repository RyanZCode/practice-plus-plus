import {
  patternEvidenceResponseSchema,
  type PatternEvidenceResponse,
} from "@practice-plus-plus/contracts";
import { Router } from "express";
import { practiceDateFor } from "./dailyPlan.js";
import { HttpError } from "./errors.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { getApplicationProfile } from "./profile.js";

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

export interface AnalyticsStore {
  patternEvidence(userProfileId: string, now: Date): Promise<PatternEvidenceResponse>;
}

export function aggregatePatternEvidence(
  patterns: readonly AnalyticsPattern[],
  attempts: readonly AnalyticsAttempt[],
  asOfPracticeDate: string,
): PatternEvidenceResponse {
  const asOfDay = calendarDay(asOfPracticeDate);
  const eligible = attempts.filter(
    (attempt) => calendarDay(attempt.practiceDate) <= asOfDay && attempt.patternIds.length > 0,
  );
  const learningAttempts = eligible.filter((attempt) => attempt.outcome !== "INCOMPLETE");
  const recent = learningAttempts.filter(
    (attempt) => calendarDay(attempt.practiceDate) >= asOfDay - 6,
  );

  return patternEvidenceResponseSchema.parse({
    asOfPracticeDate,
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
        optimality: {
          optimal: involving.filter((attempt) => attempt.optimality === "OPTIMAL").length,
          suboptimal: involving.filter((attempt) => attempt.optimality === "SUBOPTIMAL").length,
          unknownOrOmitted: involving.filter(
            (attempt) => attempt.optimality === null || attempt.optimality === "UNKNOWN",
          ).length,
        },
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
  return {
    async patternEvidence(userProfileId, now) {
      const [settings, patterns, attempts] = await client.$transaction([
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
      );
    },
  };
}

export function createAnalyticsRouter(store: AnalyticsStore, clock = () => new Date()): Router {
  const router = Router();
  router.get("/patterns", async (request, response) => {
    response.json(await store.patternEvidence(getApplicationProfile(request).id, clock()));
  });
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

function date(value: Date) {
  return value.toISOString().slice(0, 10);
}

function calendarDay(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || parsed.toISOString().slice(0, 10) !== value)
    throw new RangeError("Invalid practice date.");
  return parsed.getTime() / 86_400_000;
}
