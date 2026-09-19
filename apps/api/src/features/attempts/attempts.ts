import {
  activeAttemptResponseSchema,
  attemptHistoryQuerySchema,
  attemptHistoryResponseSchema,
  attemptHistoryPageSize,
  type AttemptHistoryQuery,
  type AttemptHistoryResponse,
  attemptSchema,
  startAttemptSchema,
  confirmAttemptSchema,
  suggestedOutcome,
  reportAttemptSchema,
  type ReportAttempt,
  type ConfirmAttempt,
  type Attempt,
  reviewOverrideSchema,
  redoNextActionSchema,
} from "@practice-plus-plus/contracts";
import {
  calculateDueDate,
  deriveReviewUrgency,
  getPracticeDate,
} from "@practice-plus-plus/scheduling";
import { Router } from "express";

import { catalogProblemSelect, toCatalogProblem } from "../catalog/catalog.js";
import { practiceDateFor } from "../daily-plan/dailyPlan.js";
import { updateDailyCompletionForAttempt } from "../daily-plan/dailyCompletion.js";
import { HttpError } from "../../shared/errors.js";
import type { PrismaClient, Prisma } from "../../shared/generated/prisma/client.js";
import { getApplicationProfile } from "../account/profile.js";

const select = {
  nextAction: true,
  id: true,
  type: true,
  practiceDate: true,
  startedAt: true,
  timerEndsAt: true,
  timerPausedAt: true,
  timerSkippedAt: true,
  confirmedAt: true,
  solutionReviewedAt: true,
  outcome: true,
  confidence: true,
  optimality: true,
  timeSpentSeconds: true,
  approach: true,
  notes: true,
  reproducedFromMemory: true,
  summary: {
    select: {
      approach: true,
      stuckPoint: true,
      misconception: true,
      assistance: true,
      progressTrigger: true,
      finalUnderstanding: true,
      nextTeachingAction: true,
      reviewedAt: true,
    },
  },
  review: { select: { generatedDueDate: true, manualDueDate: true } },
  assistance: { select: { type: true, hintLevel: true }, orderBy: { recordedAt: "asc" } },
  problem: { select: catalogProblemSelect },
} as const;
type AttemptRecord = Prisma.AttemptGetPayload<{ select: typeof select }>;

export interface AttemptStore {
  overrideReview(
    userProfileId: string,
    attemptId: string,
    manualDueDate: string | null,
  ): Promise<Attempt>;
  history(userProfileId: string, query: AttemptHistoryQuery): Promise<AttemptHistoryResponse>;
  report(userProfileId: string, attemptId: string, input: ReportAttempt): Promise<Attempt>;
  active(userProfileId: string): Promise<Attempt | null>;
  start(userProfileId: string, problemId: string, now: Date): Promise<Attempt>;
  startExtra(userProfileId: string, now: Date, problemId?: string): Promise<Attempt | null>;
  skip(userProfileId: string, attemptId: string, now: Date): Promise<Attempt>;
  pause(userProfileId: string, attemptId: string, now: Date): Promise<Attempt>;
  resume(userProfileId: string, attemptId: string, now: Date): Promise<Attempt>;
  reviewSolution(userProfileId: string, attemptId: string, now: Date): Promise<Attempt>;
  confirm(
    userProfileId: string,
    attemptId: string,
    input: ConfirmAttempt,
    now: Date,
  ): Promise<Attempt>;
}

export function createPrismaAttemptStore(client: PrismaClient): AttemptStore {
  async function present(
    db: Prisma.TransactionClient,
    userProfileId: string,
    record: AttemptRecord,
  ) {
    const tags = await db.problemPattern.findMany({
      where: {
        problemId: record.problem.id,
        problem: {
          attempts: {
            some: { userProfileId, outcome: { in: ["INDEPENDENT", "ASSISTED", "GAVE_UP"] } },
          },
        },
      },
      select: { pattern: { select: { name: true } } },
      orderBy: { pattern: { name: "asc" } },
    });
    return attemptSchema.parse({
      ...toAttempt(record),
      ...(tags.length === 0 ? {} : { patterns: tags.map((tag) => tag.pattern.name) }),
    });
  }
  async function change(
    userProfileId: string,
    attemptId: string,
    action: (tx: Prisma.TransactionClient, record: AttemptRecord) => Promise<AttemptRecord>,
  ) {
    return client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM user_profiles WHERE id = ${userProfileId}::uuid FOR UPDATE`;
      const record = await tx.attempt.findFirst({
        where: { id: attemptId, userProfileId },
        select,
      });
      if (record === null) throw new HttpError(404, "Attempt not found.");
      return present(tx, userProfileId, await action(tx, record));
    });
  }
  return {
    async overrideReview(userProfileId, attemptId, manualDueDate) {
      return change(userProfileId, attemptId, async (tx, record) => {
        if (record.review === null) throw new HttpError(404, "Review not found.");
        return tx.attempt.update({
          where: { id: attemptId, userProfileId },
          data: {
            review: {
              update: {
                manualDueDate:
                  manualDueDate === null ? null : new Date(`${manualDueDate}T00:00:00.000Z`),
              },
            },
          },
          select,
        });
      });
    },
    async history(userProfileId, query) {
      const where = {
        userProfileId,
        confirmedAt: { not: null },
        ...(query.problemId === undefined ? {} : { problemId: query.problemId }),
      } satisfies Prisma.AttemptWhereInput;
      const [total, records] = await Promise.all([
        client.attempt.count({ where }),
        client.attempt.findMany({
          where,
          orderBy: [{ confirmedAt: "desc" }, { id: "desc" }],
          skip: (query.page - 1) * attemptHistoryPageSize,
          take: attemptHistoryPageSize,
          select,
        }),
      ]);
      return attemptHistoryResponseSchema.parse({
        attempts: records.map(toAttempt),
        page: query.page,
        totalPages: Math.ceil(total / attemptHistoryPageSize),
      });
    },
    async report(userProfileId, attemptId, input) {
      return change(userProfileId, attemptId, async (tx, record) => {
        if (record.confirmedAt !== null)
          throw new HttpError(409, "This attempt is already confirmed.");
        const required = suggestedOutcome(record.assistance);
        if (
          (record.outcome === "GAVE_UP" || required === "GAVE_UP") &&
          input.outcome !== "GAVE_UP"
        ) {
          throw new HttpError(409, "Giving up requires the gave-up outcome.");
        }
        if (
          (record.outcome === "ASSISTED" || required === "ASSISTED") &&
          input.outcome === "INDEPENDENT"
        ) {
          throw new HttpError(
            409,
            "Recorded assistance is inconsistent with an independent solve.",
          );
        }
        if (record.outcome === input.outcome) return record;
        return tx.attempt.update({
          where: { id: attemptId, userProfileId },
          data: { outcome: input.outcome },
          select,
        });
      });
    },
    async reviewSolution(userProfileId, attemptId, now) {
      return change(userProfileId, attemptId, async (tx, record) => {
        if (record.confirmedAt !== null)
          throw new HttpError(409, "This attempt is already confirmed.");
        if (record.solutionReviewedAt !== null) return record;
        return tx.attempt.update({
          where: { id: attemptId, userProfileId },
          data: {
            outcome: "GAVE_UP",
            solutionReviewedAt: now,
            assistance: {
              create: { type: "SOLUTION_REVIEW", source: "LEETCODE_SOLUTION", recordedAt: now },
            },
          },
          select,
        });
      });
    },
    async confirm(userProfileId, attemptId, input, now) {
      return change(userProfileId, attemptId, async (tx, record) => {
        if (
          record.outcome !== null &&
          record.outcome !== "INCOMPLETE" &&
          input.outcome === "INCOMPLETE"
        ) {
          throw new HttpError(409, "A reported result cannot become incomplete.");
        }
        if (record.outcome === "ASSISTED" && input.outcome === "INDEPENDENT") {
          throw new HttpError(409, "An assisted result cannot become independent.");
        }
        const required = suggestedOutcome([...record.assistance, ...input.assistance]);
        if (
          (record.outcome === "GAVE_UP" || required === "GAVE_UP") &&
          input.outcome !== "GAVE_UP"
        ) {
          throw new HttpError(409, "Solution review or giving up requires the gave-up outcome.");
        }
        if (required === "ASSISTED" && input.outcome === "INDEPENDENT") {
          throw new HttpError(
            409,
            "Recorded assistance is inconsistent with an independent solve.",
          );
        }
        if (required !== "GAVE_UP" && input.reproducedFromMemory !== null) {
          throw new HttpError(400, "Reproduction applies only after solution review.");
        }
        if (record.confirmedAt !== null) {
          if (record.outcome !== input.outcome) {
            throw new HttpError(409, "This attempt is already confirmed with a different outcome.");
          }
          if (
            JSON.stringify(
              record.nextAction == null ? undefined : redoNextActionSchema.parse(record.nextAction),
            ) !== JSON.stringify(input.nextAction)
          ) {
            throw new HttpError(
              409,
              "This attempt is already confirmed with a different next action.",
            );
          }
          return record;
        }
        const { assistance, nextAction, summary, ...details } = input;
        const successfulRedo =
          record.type === "REDO" &&
          (input.outcome === "INDEPENDENT" || input.outcome === "ASSISTED");
        if (!successfulRedo && nextAction !== undefined) {
          throw new HttpError(400, "Next actions apply only to successful redos.");
        }
        const derivedUrgency = deriveReviewUrgency({
          ...input,
          confirmedAt: now.toISOString(),
          assistance: [...record.assistance, ...assistance],
        });
        const urgency =
          nextAction === undefined
            ? derivedUrgency
            : nextAction.type === "REPEAT" || nextAction.type === "CUSTOM_DATE"
              ? (derivedUrgency ?? "LOW")
              : null;
        let transfer;
        if (nextAction?.type === "TRANSFER") {
          const tags = await tx.problemPattern.findMany({
            where: { problemId: record.problem.id, pattern: { name: nextAction.pattern } },
            select: { patternId: true },
          });
          const tag = tags[0];
          if (tag === undefined) throw new HttpError(400, "Choose a pattern from this problem.");
          transfer = {
            create: {
              patternId: tag.patternId,
              generatedEligibleDate: new Date(
                `${calculateDueDate(record.practiceDate.toISOString().slice(0, 10), "LOW", {
                  high: 7,
                  medium: 7,
                  low: 7,
                })}T00:00:00.000Z`,
              ),
              ...(nextAction.dueDate === undefined
                ? {}
                : {
                    manualEligibleDate: new Date(`${nextAction.dueDate}T00:00:00.000Z`),
                  }),
            },
          };
        }
        let review;
        if (urgency !== null) {
          const settings = await tx.practiceSettings.findUnique({ where: { userProfileId } });
          if (settings === null)
            throw new HttpError(409, "Save practice settings before confirming.");
          review = {
            create: {
              urgency,
              ...(nextAction?.type === "CUSTOM_DATE"
                ? {
                    manualDueDate: new Date(`${nextAction.dueDate}T00:00:00.000Z`),
                  }
                : {}),
              generatedDueDate: new Date(
                `${calculateDueDate(record.practiceDate.toISOString().slice(0, 10), urgency, {
                  high: settings.highIntervalDays,
                  medium: settings.mediumIntervalDays,
                  low: settings.lowIntervalDays,
                })}T00:00:00.000Z`,
              ),
            },
          };
        }
        await tx.reviewObligation.updateMany({
          where: {
            resolvedAt: null,
            sourceAttempt: { userProfileId, problemId: record.problem.id, id: { not: attemptId } },
          },
          data: { resolvedAt: now },
        });
        await tx.transferObligation.updateMany({
          where: { attemptId, resolvedAt: null, sourceAttempt: { userProfileId } },
          data: { resolvedAt: now },
        });
        const updated = await tx.attempt.update({
          where: { id: attemptId, userProfileId },
          data: {
            ...details,
            ...(nextAction === undefined ? {} : { nextAction }),
            ...(transfer === undefined ? {} : { transfersCreated: transfer }),
            confirmedAt: now,
            ...(review === undefined ? {} : { review }),
            ...(summary === undefined
              ? {}
              : summary === null
                ? record.summary == null
                  ? {}
                  : { summary: { delete: true } }
                : {
                    summary: {
                      upsert: {
                        create: { ...summary, reviewedAt: now },
                        update: { ...summary, reviewedAt: now },
                      },
                    },
                  }),
            assistance: {
              create: assistance.map((event) => ({
                ...event,
                source: "SELF_REPORTED" as const,
                recordedAt: now,
              })),
            },
          },
          select,
        });
        await updateDailyCompletionForAttempt(tx, userProfileId, attemptId, input.outcome, now);
        return updated;
      });
    },
    async active(userProfileId) {
      const record = await client.attempt.findFirst({
        where: { userProfileId, confirmedAt: null },
        select,
      });
      return record === null ? null : present(client, userProfileId, record);
    },
    async start(userProfileId, problemId, now) {
      return client.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM user_profiles WHERE id = ${userProfileId}::uuid FOR UPDATE`;
        const active = await tx.attempt.findFirst({
          where: { userProfileId, confirmedAt: null },
          select,
        });
        if (active !== null) {
          if (active.problem.id === problemId) {
            return present(tx, userProfileId, active);
          }
          throw new HttpError(409, "Finish your active attempt before starting another problem.");
        }
        const settings = await tx.practiceSettings.findUnique({ where: { userProfileId } });
        if (settings === null) {
          throw new HttpError(409, "Save your practice settings before starting an attempt.");
        }
        const problem = await tx.problem.findFirst({
          where: { id: problemId, published: true, availability: { not: "UNAVAILABLE" } },
          select: { id: true },
        });
        if (problem === null) throw new HttpError(404, "Eligible problem not found.");
        const previous = await tx.attempt.findFirst({
          where: { userProfileId, problemId, confirmedAt: { not: null } },
          select: { id: true },
        });
        const resetTime = `${Math.floor(settings.resetMinutes / 60)
          .toString()
          .padStart(2, "0")}:${(settings.resetMinutes % 60).toString().padStart(2, "0")}`;
        const record = await tx.attempt.create({
          data: {
            userProfileId,
            problemId,
            type: previous === null ? "FRESH" : "REDO",
            practiceDate: new Date(
              `${getPracticeDate(now, settings.timeZone, resetTime)}T00:00:00.000Z`,
            ),
            startedAt: now,
            timerEndsAt: new Date(now.getTime() + settings.attemptTimerMinutes * 60_000),
          },
          select,
        });
        const plan = await tx.dailyPlan.findUnique({
          where: { userProfileId },
          select: { practiceDate: true, timeZone: true, resetMinutes: true },
        });
        if (
          plan !== null &&
          practiceDateFor(now, plan) === plan.practiceDate.toISOString().slice(0, 10)
        ) {
          const item = await tx.dailyPlanItem.findFirst({
            where: { userProfileId, problemId, attemptId: null },
          });
          if (item !== null) {
            await tx.dailyPlanItem.update({
              where: { id: item.id },
              data: { attemptId: record.id },
            });
            if (item.transferId !== null) {
              await tx.transferObligation.updateMany({
                where: {
                  id: item.transferId,
                  attemptId: null,
                  resolvedAt: null,
                  sourceAttempt: { userProfileId },
                },
                data: { attemptId: record.id },
              });
            }
          }
        }
        return present(tx, userProfileId, record);
      });
    },
    async startExtra(userProfileId, now, problemId) {
      return client.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM user_profiles WHERE id = ${userProfileId}::uuid FOR UPDATE`;
        const active = await tx.attempt.findFirst({
          where: { userProfileId, confirmedAt: null },
          select,
        });
        if (active !== null) {
          throw new HttpError(409, "Finish your active attempt before starting another problem.");
        }

        const settings = await tx.practiceSettings.findUnique({ where: { userProfileId } });
        if (settings === null) {
          throw new HttpError(409, "Save your practice settings before starting an attempt.");
        }
        const plan = await tx.dailyPlan.findUnique({
          where: { userProfileId },
          select: {
            practiceDate: true,
            timeZone: true,
            resetMinutes: true,
            items: { select: { attempt: { select: { confirmedAt: true, outcome: true } } } },
          },
        });
        if (
          plan === null ||
          practiceDateFor(now, plan) !== plan.practiceDate.toISOString().slice(0, 10) ||
          plan.items.length === 0 ||
          plan.items.some(
            (item) =>
              item.attempt === null ||
              item.attempt.confirmedAt === null ||
              (item.attempt.outcome !== "INDEPENDENT" &&
                item.attempt.outcome !== "ASSISTED" &&
                item.attempt.outcome !== "GAVE_UP"),
          )
        ) {
          throw new HttpError(409, "Complete today's saved plan before starting extra practice.");
        }
        const practiceDate = plan.practiceDate.toISOString().slice(0, 10);

        const candidates = await tx.problem.findMany({
          where: {
            published: true,
            ...(settings.difficultyPreference === "ANY"
              ? {}
              : {
                  difficulty:
                    settings.difficultyPreference === "EASIER"
                      ? { in: ["EASY", "MEDIUM"] }
                      : "MEDIUM",
                }),
            availability: settings.allowPremiumProblems
              ? { not: "UNAVAILABLE" }
              : { notIn: ["PAID_ONLY", "UNAVAILABLE"] },
          },
          orderBy:
            settings.difficultyPreference === "EASIER"
              ? [{ difficulty: "asc" }, { leetcodeId: "asc" }]
              : { leetcodeId: "asc" },
          select: { id: true },
        });
        const attempts = await tx.attempt.findMany({
          where: { userProfileId },
          select: { problemId: true },
        });
        const attempted = new Set(attempts.map((attempt) => attempt.problemId));
        const problem =
          problemId === undefined
            ? candidates.find((candidate) => !attempted.has(candidate.id))
            : candidates.find(
                (candidate) => candidate.id === problemId && !attempted.has(candidate.id),
              );
        if (problemId !== undefined && problem === undefined) {
          throw new HttpError(409, "That extra practice problem is no longer eligible.");
        }
        if (problem === undefined) return null;

        const record = await tx.attempt.create({
          data: {
            userProfileId,
            problemId: problem.id,
            type: "FRESH",
            practiceDate: new Date(`${practiceDate}T00:00:00.000Z`),
            startedAt: now,
            timerEndsAt: new Date(now.getTime() + settings.attemptTimerMinutes * 60_000),
          },
          select,
        });
        return present(tx, userProfileId, record);
      });
    },
    async skip(userProfileId, attemptId, now) {
      return client.$transaction(async (tx) => {
        await tx.attempt.updateMany({
          where: { id: attemptId, userProfileId, confirmedAt: null, timerSkippedAt: null },
          data: { timerSkippedAt: now, timerPausedAt: null },
        });
        const record = await tx.attempt.findFirst({
          where: { id: attemptId, userProfileId, confirmedAt: null },
          select,
        });
        if (record === null) throw new HttpError(404, "Active attempt not found.");
        return present(tx, userProfileId, record);
      });
    },
    async pause(userProfileId, attemptId, now) {
      return change(userProfileId, attemptId, async (tx, record) => {
        if (record.confirmedAt !== null)
          throw new HttpError(409, "This attempt is already confirmed.");
        if (record.timerSkippedAt !== null || record.timerPausedAt !== null) return record;
        return tx.attempt.update({
          where: { id: attemptId, userProfileId },
          data: { timerPausedAt: now },
          select,
        });
      });
    },
    async resume(userProfileId, attemptId, now) {
      return change(userProfileId, attemptId, async (tx, record) => {
        if (record.confirmedAt !== null)
          throw new HttpError(409, "This attempt is already confirmed.");
        if (record.timerSkippedAt !== null || record.timerPausedAt === null) return record;
        return tx.attempt.update({
          where: { id: attemptId, userProfileId },
          data: {
            timerEndsAt: new Date(
              record.timerEndsAt.getTime() + now.getTime() - record.timerPausedAt.getTime(),
            ),
            timerPausedAt: null,
          },
          select,
        });
      });
    },
  };
}

export function createAttemptRouter(store: AttemptStore, clock = () => new Date()): Router {
  const router = Router();
  router.post("/extra", async (request, response) => {
    if (
      request.body !== undefined &&
      (request.body === null ||
        typeof request.body !== "object" ||
        Array.isArray(request.body) ||
        Object.keys(request.body).length > 0)
    ) {
      throw new HttpError(400, "Extra practice does not accept request data.");
    }
    response.json(
      activeAttemptResponseSchema.parse({
        attempt: await store.startExtra(getApplicationProfile(request).id, clock()),
      }),
    );
  });
  router.put("/:attemptId/review", async (request, response) => {
    const id = attemptSchema.shape.id.safeParse(request.params.attemptId);
    const input = reviewOverrideSchema.safeParse(request.body);
    if (!id.success || !input.success) throw new HttpError(400, "Invalid review override.");
    response.json(
      attemptSchema.parse(
        await store.overrideReview(
          getApplicationProfile(request).id,
          id.data,
          input.data.manualDueDate,
        ),
      ),
    );
  });
  router.get("/", async (request, response) => {
    const query = parseHistoryQuery(request.query);
    response.json(
      attemptHistoryResponseSchema.parse(
        await store.history(getApplicationProfile(request).id, query),
      ),
    );
  });
  router.post("/:attemptId/report-result", async (request, response) => {
    const id = attemptSchema.shape.id.safeParse(request.params.attemptId);
    const input = reportAttemptSchema.safeParse(request.body);
    if (!id.success || !input.success) throw new HttpError(400, "Invalid attempt result.");
    response.json(
      attemptSchema.parse(
        await store.report(getApplicationProfile(request).id, id.data, input.data),
      ),
    );
  });
  router.get("/active", async (request, response) => {
    response.json(
      activeAttemptResponseSchema.parse({
        attempt: await store.active(getApplicationProfile(request).id),
      }),
    );
  });
  router.post("/", async (request, response) => {
    const parsed = startAttemptSchema.safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, "Invalid attempt request.");
    response.json(
      attemptSchema.parse(
        await store.start(getApplicationProfile(request).id, parsed.data.problemId, clock()),
      ),
    );
  });
  router.post("/:attemptId/skip-timer", async (request, response) => {
    const parsed = attemptSchema.shape.id.safeParse(request.params.attemptId);
    if (!parsed.success) throw new HttpError(400, "Invalid attempt identifier.");
    response.json(
      attemptSchema.parse(
        await store.skip(getApplicationProfile(request).id, parsed.data, clock()),
      ),
    );
  });
  router.post("/:attemptId/pause-timer", async (request, response) => {
    const parsed = attemptSchema.shape.id.safeParse(request.params.attemptId);
    if (!parsed.success) throw new HttpError(400, "Invalid attempt identifier.");
    response.json(
      attemptSchema.parse(
        await store.pause(getApplicationProfile(request).id, parsed.data, clock()),
      ),
    );
  });
  router.post("/:attemptId/resume-timer", async (request, response) => {
    const parsed = attemptSchema.shape.id.safeParse(request.params.attemptId);
    if (!parsed.success) throw new HttpError(400, "Invalid attempt identifier.");
    response.json(
      attemptSchema.parse(
        await store.resume(getApplicationProfile(request).id, parsed.data, clock()),
      ),
    );
  });
  router.post("/:attemptId/review-solution", async (request, response) => {
    const id = attemptSchema.shape.id.safeParse(request.params.attemptId);
    if (!id.success || request.body?.giveUp !== true || Object.keys(request.body).length !== 1) {
      throw new HttpError(400, "Explicit give-up is required to review a solution.");
    }
    response.json(
      attemptSchema.parse(
        await store.reviewSolution(getApplicationProfile(request).id, id.data, clock()),
      ),
    );
  });
  router.post("/:attemptId/confirm", async (request, response) => {
    const id = attemptSchema.shape.id.safeParse(request.params.attemptId);
    const parsed = confirmAttemptSchema.safeParse(request.body);
    if (!id.success || !parsed.success) throw new HttpError(400, "Invalid attempt confirmation.");
    response.json(
      attemptSchema.parse(
        await store.confirm(getApplicationProfile(request).id, id.data, parsed.data, clock()),
      ),
    );
  });
  return router;
}

function parseHistoryQuery(rawQuery: unknown): AttemptHistoryQuery {
  if (rawQuery === null || typeof rawQuery !== "object" || Array.isArray(rawQuery)) {
    throw new HttpError(400, "Invalid history page.");
  }
  const query = rawQuery as Record<string, unknown>;
  if (Object.keys(query).some((key) => key !== "page" && key !== "problemId")) {
    throw new HttpError(400, "Invalid history page.");
  }
  const rawPage = query.page;
  const page = rawPage === undefined ? 1 : typeof rawPage === "string" ? Number(rawPage) : null;
  const problemId =
    query.problemId === undefined
      ? undefined
      : typeof query.problemId === "string"
        ? query.problemId
        : null;
  const parsed = attemptHistoryQuerySchema.safeParse({ page, problemId });
  if (!parsed.success) throw new HttpError(400, "Invalid history page.");
  return parsed.data;
}

function toAttempt(record: AttemptRecord): Attempt {
  return attemptSchema.parse({
    ...(record.nextAction == null ? {} : { nextAction: record.nextAction }),
    id: record.id,
    review:
      record.review === null
        ? null
        : {
            generatedDueDate: record.review.generatedDueDate.toISOString().slice(0, 10),
            manualDueDate: record.review.manualDueDate?.toISOString().slice(0, 10) ?? null,
          },
    problem: toCatalogProblem(record.problem),
    type: record.type,
    practiceDate: record.practiceDate.toISOString().slice(0, 10),
    startedAt: record.startedAt.toISOString(),
    timerEndsAt: record.timerEndsAt.toISOString(),
    timerPausedAt: record.timerPausedAt?.toISOString() ?? null,
    timerSkippedAt: record.timerSkippedAt?.toISOString() ?? null,
    confirmedAt: record.confirmedAt?.toISOString() ?? null,
    solutionReviewedAt: record.solutionReviewedAt?.toISOString() ?? null,
    outcome: record.outcome,
    confidence: record.confidence,
    optimality: record.optimality,
    timeSpentSeconds: record.timeSpentSeconds,
    approach: record.approach,
    notes: record.notes,
    reproducedFromMemory: record.reproducedFromMemory,
    ...(record.summary == null
      ? {}
      : {
          summary: {
            approach: record.summary.approach,
            stuckPoint: record.summary.stuckPoint,
            misconception: record.summary.misconception,
            assistance: record.summary.assistance,
            progressTrigger: record.summary.progressTrigger,
            finalUnderstanding: record.summary.finalUnderstanding,
            nextTeachingAction: record.summary.nextTeachingAction,
            reviewedAt: record.summary.reviewedAt?.toISOString() ?? null,
          },
        }),
    assistance: record.assistance,
  });
}
