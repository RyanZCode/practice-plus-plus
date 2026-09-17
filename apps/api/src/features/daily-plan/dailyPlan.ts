import { dailyPlanSchema, type DailyPlan } from "@practice-plus-plus/contracts";
import { buildDailyPlan, getPracticeDate } from "@practice-plus-plus/scheduling";
import { Router } from "express";
import { catalogProblemSelect, toCatalogProblem } from "../catalog/catalog.js";
import { HttpError } from "../../shared/errors.js";
import type { Prisma, PrismaClient } from "../../shared/generated/prisma/client.js";
import { getApplicationProfile } from "../account/profile.js";

const select = {
  practiceDate: true,
  target: true,
  timeZone: true,
  resetMinutes: true,
  items: {
    orderBy: { position: "asc" },
    select: {
      id: true,
      kind: true,
      reason: true,
      problem: { select: catalogProblemSelect },
      attempt: { select: { confirmedAt: true } },
    },
  },
} as const;

const explanations: Record<string, string> = {
  FRESH_DIAGNOSTIC: "An unprompted fresh problem to broaden your practice.",
  FRESH_PRACTICE: "Fresh practice selected from your learning history.",
  OVERDUE_REVIEW: "An exact retry or redo carried forward from an earlier day.",
  REVIEW_DUE: "An exact retry or redo scheduled for today.",
  TRANSFER_DUE: "A fresh follow-up scheduled after an earlier review.",
};

export function practiceDateFor(now: Date, settings: { timeZone: string; resetMinutes: number }) {
  const resetTime = `${Math.floor(settings.resetMinutes / 60)
    .toString()
    .padStart(2, "0")}:${(settings.resetMinutes % 60).toString().padStart(2, "0")}`;
  return getPracticeDate(now, settings.timeZone, resetTime);
}

export interface DailyPlanStore {
  current(userProfileId: string, now: Date): Promise<DailyPlan>;
  saved(userProfileId: string, now: Date): Promise<DailyPlan | null>;
  recommended(
    userProfileId: string,
    now: Date,
    freshProblemIds: readonly string[],
  ): Promise<DailyPlan>;
}

export function createPrismaDailyPlanStore(client: PrismaClient): DailyPlanStore {
  async function generate(
    userProfileId: string,
    now: Date,
    freshProblemIds?: readonly string[],
  ): Promise<DailyPlan> {
    return client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM user_profiles WHERE id = ${userProfileId}::uuid FOR UPDATE`;
      const saved = await tx.dailyPlan.findUnique({ where: { userProfileId }, select });
      if (saved !== null && practiceDateFor(now, saved) === date(saved.practiceDate)) {
        if (freshProblemIds !== undefined)
          throw new HttpError(409, "Today's plan has already been saved.");
        return present(saved);
      }
      const settings = await tx.practiceSettings.findUnique({ where: { userProfileId } });
      if (settings === null)
        throw new HttpError(409, "Save practice settings before generating a plan.");
      const profile = await tx.userProfile.findUniqueOrThrow({
        where: { id: userProfileId },
        select: { hidePaidProblems: true },
      });
      const practiceDate = practiceDateFor(now, settings);
      const problems = await tx.problem.findMany({
        select: {
          ...catalogProblemSelect,
          published: true,
          problemPatterns: { select: { patternId: true } },
        },
      });
      const attempts = await tx.attempt.findMany({
        where: { userProfileId },
        select: {
          id: true,
          problemId: true,
          type: true,
          practiceDate: true,
          startedAt: true,
          confirmedAt: true,
          outcome: true,
          confidence: true,
          optimality: true,
          problem: { select: { problemPatterns: { select: { patternId: true } } } },
        },
      });
      const reviews = await tx.reviewObligation.findMany({
        where: { resolvedAt: null, sourceAttempt: { userProfileId } },
        include: { sourceAttempt: { select: { problemId: true } } },
      });
      const transfers = await tx.transferObligation.findMany({
        where: { resolvedAt: null, attemptId: null, sourceAttempt: { userProfileId } },
      });
      const planInput = {
        target: settings.dailyTarget,
        practiceDate,
        hidePaidProblems: profile.hidePaidProblems,
        candidates: problems.map((p) => ({
          ...p,
          patternIds: p.problemPatterns.map((tag) => tag.patternId),
        })),
        history: attempts.map((a) => ({
          ...a,
          practiceDate: date(a.practiceDate),
          startedAt: a.startedAt.toISOString(),
          confirmedAt: a.confirmedAt?.toISOString() ?? null,
          patternIds: a.problem.problemPatterns.map((tag) => tag.patternId),
        })),
        reviews: reviews.map((r) => ({
          ...r,
          problemId: r.sourceAttempt.problemId,
          generatedDueDate: date(r.generatedDueDate),
          manualDueDate: r.manualDueDate === null ? null : date(r.manualDueDate),
        })),
        transfers: transfers.map((t) => ({
          id: t.id,
          patternId: t.patternId,
          eligibleDate: date(t.manualEligibleDate ?? t.generatedEligibleDate),
        })),
        ...(freshProblemIds === undefined ? {} : { freshProblemIds }),
      };
      if (freshProblemIds !== undefined) {
        const eligible = new Set(
          planInput.candidates
            .filter(
              (problem) =>
                problem.published &&
                problem.availability !== "UNAVAILABLE" &&
                !(profile.hidePaidProblems && problem.availability === "PAID_ONLY") &&
                !attempts.some((attempt) => attempt.problemId === problem.id),
            )
            .map((problem) => problem.id),
        );
        const expected = Math.min(settings.dailyTarget, eligible.size);
        if (
          freshProblemIds.length !== expected ||
          new Set(freshProblemIds).size !== freshProblemIds.length ||
          freshProblemIds.some((id) => !eligible.has(id))
        )
          throw new HttpError(409, "The planning recommendation is no longer valid.");
      }
      const selections = buildDailyPlan(planInput);
      await tx.dailyPlan.deleteMany({ where: { userProfileId } });
      return present(
        await tx.dailyPlan.create({
          data: {
            userProfileId,
            practiceDate: new Date(`${practiceDate}T00:00:00.000Z`),
            target: settings.dailyTarget,
            timeZone: settings.timeZone,
            resetMinutes: settings.resetMinutes,
            items: { create: selections.map((item, position) => ({ ...item, position })) },
          },
          select,
        }),
      );
    });
  }
  return {
    current: (userProfileId, now) => generate(userProfileId, now),
    recommended: (userProfileId, now, freshProblemIds) =>
      generate(userProfileId, now, freshProblemIds),
    async saved(userProfileId, now) {
      const saved = await client.dailyPlan.findUnique({ where: { userProfileId }, select });
      return saved !== null && practiceDateFor(now, saved) === date(saved.practiceDate)
        ? present(saved)
        : null;
    },
  };
}

function date(value: Date) {
  return value.toISOString().slice(0, 10);
}
function present(plan: Prisma.DailyPlanGetPayload<{ select: typeof select }>): DailyPlan {
  return dailyPlanSchema.parse({
    practiceDate: date(plan.practiceDate),
    target: plan.target,
    items: plan.items.map((item) => ({
      id: item.id,
      problem: toCatalogProblem(item.problem),
      kind: item.kind,
      explanation: explanations[item.reason],
      status:
        item.attempt === null
          ? "PENDING"
          : item.attempt.confirmedAt === null
            ? "ACTIVE"
            : "FINISHED",
    })),
  });
}

export function createDailyPlanRouter(store: DailyPlanStore, clock = () => new Date()): Router {
  const router = Router();
  router.get("/", async (request, response) => {
    response.json(
      dailyPlanSchema.parse(await store.current(getApplicationProfile(request).id, clock())),
    );
  });
  router.get("/saved", async (request, response) => {
    response.json({ plan: await store.saved(getApplicationProfile(request).id, clock()) });
  });
  return router;
}
