import {
  activeAttemptResponseSchema,
  attemptSchema,
  startAttemptSchema,
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
  problem: { select: catalogProblemSelect },
} as const;
type AttemptRecord = Prisma.AttemptGetPayload<{ select: typeof select }>;

export interface AttemptStore {
  active(userProfileId: string): Promise<Attempt | null>;
  start(userProfileId: string, problemId: string, now: Date): Promise<Attempt>;
  skip(userProfileId: string, attemptId: string, now: Date): Promise<Attempt>;
}

export function createPrismaAttemptStore(client: PrismaClient): AttemptStore {
  return {
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
  });
}
