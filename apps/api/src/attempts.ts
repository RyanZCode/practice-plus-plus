import {
  activeAttemptResponseSchema,
  attemptSchema,
  startAttemptSchema,
  confirmAttemptSchema,
  suggestedOutcome,
  type ConfirmAttempt,
  type Attempt,
} from "@practice-plus-plus/contracts";
import { getPracticeDate } from "@practice-plus-plus/scheduling";
import { Router } from "express";

import { catalogProblemSelect, toCatalogProblem } from "./catalog.js";
import { HttpError } from "./errors.js";
import type { PrismaClient, Prisma } from "./generated/prisma/client.js";
import { getApplicationProfile } from "./profile.js";

const select = {
  id: true,
  type: true,
  practiceDate: true,
  startedAt: true,
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
  assistance: { select: { type: true, hintLevel: true }, orderBy: { recordedAt: "asc" } },
  problem: { select: catalogProblemSelect },
} as const;
type AttemptRecord = Prisma.AttemptGetPayload<{ select: typeof select }>;

export interface AttemptStore {
  active(userProfileId: string): Promise<Attempt | null>;
  start(userProfileId: string, problemId: string, now: Date): Promise<Attempt>;
  skip(userProfileId: string, attemptId: string, now: Date): Promise<Attempt>;
  reviewSolution(userProfileId: string, attemptId: string, now: Date): Promise<Attempt>;
  confirm(
    userProfileId: string,
    attemptId: string,
    input: ConfirmAttempt,
    now: Date,
  ): Promise<Attempt>;
}

export function createPrismaAttemptStore(client: PrismaClient): AttemptStore {
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
      return toAttempt(await action(tx, record));
    });
  }
  return {
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
        if (required === "GAVE_UP" && input.reproducedFromMemory === null) {
          throw new HttpError(409, "Report whether you could reproduce the solution from memory.");
        }
        if (required !== "GAVE_UP" && input.reproducedFromMemory !== null) {
          throw new HttpError(400, "Reproduction applies only after solution review.");
        }
        if (record.confirmedAt !== null) {
          if (record.outcome !== input.outcome) {
            throw new HttpError(409, "This attempt is already confirmed with a different outcome.");
          }
          return record;
        }
        const { assistance, ...details } = input;
        return tx.attempt.update({
          where: { id: attemptId, userProfileId },
          data: {
            ...details,
            confirmedAt: now,
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
      });
    },
    async active(userProfileId) {
      const record = await client.attempt.findFirst({
        where: { userProfileId, confirmedAt: null },
        select,
      });
      return record === null ? null : toAttempt(record);
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
            return toAttempt(active);
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
          },
          select,
        });
        return toAttempt(record);
      });
    },
    async skip(userProfileId, attemptId, now) {
      return client.$transaction(async (tx) => {
        await tx.attempt.updateMany({
          where: { id: attemptId, userProfileId, confirmedAt: null, timerSkippedAt: null },
          data: { timerSkippedAt: now },
        });
        const record = await tx.attempt.findFirst({
          where: { id: attemptId, userProfileId, confirmedAt: null },
          select,
        });
        if (record === null) throw new HttpError(404, "Active attempt not found.");
        return toAttempt(record);
      });
    },
  };
}

export function createAttemptRouter(store: AttemptStore, clock = () => new Date()): Router {
  const router = Router();
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

function toAttempt(record: AttemptRecord): Attempt {
  return attemptSchema.parse({
    id: record.id,
    problem: toCatalogProblem(record.problem),
    type: record.type,
    practiceDate: record.practiceDate.toISOString().slice(0, 10),
    startedAt: record.startedAt.toISOString(),
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
    assistance: record.assistance,
  });
}
