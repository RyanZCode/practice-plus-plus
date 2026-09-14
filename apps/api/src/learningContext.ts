import {
  learnerGoalInputSchema,
  learnerGoalSchema,
  learningContextInferenceSchema,
  learningContextResponseSchema,
  memoryReviewSchema,
  teachingPreferenceInputSchema,
  teachingPreferenceSchema,
  type LearnerGoal,
  type LearnerGoalInput,
  type LearningContextEvidence,
  type LearningContextInference,
  type LearningContextResponse,
  type MemoryReview,
  type TeachingPreference,
  type TeachingPreferenceInput,
} from "@practice-plus-plus/contracts";
import { Router } from "express";
import type { Prisma, PrismaClient } from "./generated/prisma/client.js";
import { HttpError } from "./errors.js";
import { getApplicationProfile } from "./profile.js";

const memorySelect = {
  id: true,
  category: true,
  content: true,
  confidence: true,
  lastObservedAt: true,
  lifecycleState: true,
  approvalState: true,
  reviewedAt: true,
  evidence: {
    orderBy: { createdAt: "asc" as const },
    select: {
      learnerGoal: { select: { id: true, target: true } },
      teachingPreference: { select: { id: true, preference: true } },
      attempt: {
        select: {
          id: true,
          confirmedAt: true,
          outcome: true,
          problem: { select: { title: true } },
        },
      },
      assistanceEvent: {
        select: {
          id: true,
          type: true,
          recordedAt: true,
          attempt: { select: { id: true, problem: { select: { title: true } } } },
        },
      },
      attemptSummary: {
        select: {
          attemptId: true,
          updatedAt: true,
          attempt: { select: { problem: { select: { title: true } } } },
        },
      },
      conversationSummary: {
        select: { id: true, mode: true, topics: true, updatedAt: true },
      },
    },
  },
} as const;

type MemoryRecord = Prisma.LearnerMemoryGetPayload<{ select: typeof memorySelect }>;

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function label(value: string): string {
  return value.slice(0, 1000);
}

function presentMemory(record: MemoryRecord): LearningContextInference {
  const evidence: LearningContextEvidence[] = [];
  for (const item of record.evidence) {
    if (item.learnerGoal !== null)
      evidence.push({
        type: "LEARNER_GOAL",
        id: item.learnerGoal.id,
        label: item.learnerGoal.target,
      });
    else if (item.teachingPreference !== null)
      evidence.push({
        type: "TEACHING_PREFERENCE",
        id: item.teachingPreference.id,
        label: item.teachingPreference.preference,
      });
    else if (
      item.attempt !== null &&
      item.attempt.confirmedAt !== null &&
      item.attempt.outcome !== null
    )
      evidence.push({
        type: "ATTEMPT",
        id: item.attempt.id,
        label: label(`${item.attempt.problem.title}: ${titleCase(item.attempt.outcome)}`),
        occurredAt: item.attempt.confirmedAt.toISOString(),
      });
    else if (item.assistanceEvent !== null)
      evidence.push({
        type: "ASSISTANCE_EVENT",
        id: item.assistanceEvent.id,
        attemptId: item.assistanceEvent.attempt.id,
        label: label(
          `${item.assistanceEvent.attempt.problem.title}: ${titleCase(item.assistanceEvent.type)}`,
        ),
        occurredAt: item.assistanceEvent.recordedAt.toISOString(),
      });
    else if (item.attemptSummary !== null)
      evidence.push({
        type: "ATTEMPT_SUMMARY",
        id: item.attemptSummary.attemptId,
        label: label(`${item.attemptSummary.attempt.problem.title}: reviewed learning summary`),
        occurredAt: item.attemptSummary.updatedAt.toISOString(),
      });
    else if (item.conversationSummary !== null)
      evidence.push({
        type: "CONVERSATION_SUMMARY",
        id: item.conversationSummary.id,
        label: label(
          `${titleCase(item.conversationSummary.mode)}: ${item.conversationSummary.topics}`,
        ),
        occurredAt: item.conversationSummary.updatedAt.toISOString(),
      });
  }
  return learningContextInferenceSchema.parse({
    id: record.id,
    category: record.category,
    content: record.content,
    confidence: record.confidence,
    lastObservedAt: record.lastObservedAt.toISOString(),
    lifecycleState: record.lifecycleState,
    approvalState: record.approvalState,
    reviewedAt: record.reviewedAt?.toISOString() ?? null,
    evidence,
  });
}

export interface LearningContextStore {
  read(userId: string, now: Date): Promise<LearningContextResponse>;
  createGoal(userId: string, input: LearnerGoalInput): Promise<LearnerGoal>;
  updateGoal(userId: string, id: string, input: LearnerGoalInput): Promise<LearnerGoal>;
  deleteGoal(userId: string, id: string): Promise<void>;
  createTeachingPreference(
    userId: string,
    input: TeachingPreferenceInput,
  ): Promise<TeachingPreference>;
  updateTeachingPreference(
    userId: string,
    id: string,
    input: TeachingPreferenceInput,
  ): Promise<TeachingPreference>;
  deleteTeachingPreference(userId: string, id: string): Promise<void>;
  reviewMemory(
    userId: string,
    id: string,
    review: MemoryReview,
    now: Date,
  ): Promise<LearningContextInference>;
  deleteMemory(userId: string, id: string): Promise<void>;
}

export function createPrismaLearningContextStore(client: PrismaClient): LearningContextStore {
  async function ownedMemory(userId: string, id: string) {
    const memory = await client.learnerMemory.findFirst({
      where: { id, userProfileId: userId },
      select: memorySelect,
    });
    if (memory === null) throw new HttpError(404, "Inference not found.");
    return memory;
  }

  return {
    async read(userId, now) {
      const [goals, teachingPreferences, attempts, summaries, memories] = await client.$transaction(
        [
          client.learnerGoal.findMany({
            where: { userProfileId: userId },
            orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
            select: { id: true, target: true, priority: true, state: true },
          }),
          client.teachingPreference.findMany({
            where: { userProfileId: userId },
            orderBy: { createdAt: "asc" },
            select: { id: true, preference: true },
          }),
          client.attempt.findMany({
            where: { userProfileId: userId, confirmedAt: { not: null }, outcome: { not: null } },
            orderBy: [{ confirmedAt: "desc" }, { id: "desc" }],
            select: {
              id: true,
              practiceDate: true,
              confirmedAt: true,
              outcome: true,
              problem: { select: { title: true } },
              assistance: { select: { type: true }, orderBy: { recordedAt: "asc" } },
            },
          }),
          client.conversationSummary.findMany({
            where: { userProfileId: userId },
            orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
            select: {
              id: true,
              mode: true,
              attemptId: true,
              topics: true,
              learningProgress: true,
              nextSteps: true,
              updatedAt: true,
            },
          }),
          client.learnerMemory.findMany({
            where: { userProfileId: userId },
            orderBy: [{ lastObservedAt: "desc" }, { id: "desc" }],
            select: memorySelect,
          }),
        ],
        { isolationLevel: "RepeatableRead" },
      );
      return learningContextResponseSchema.parse({
        userSupplied: { goals, teachingPreferences },
        observed: {
          attempts: attempts.map((attempt) => ({
            id: attempt.id,
            problemTitle: attempt.problem.title,
            practiceDate: attempt.practiceDate.toISOString().slice(0, 10),
            confirmedAt: attempt.confirmedAt!.toISOString(),
            outcome: attempt.outcome!,
            assistance: attempt.assistance.map((event) => event.type),
          })),
          summaries: summaries.map((summary) => ({
            ...summary,
            updatedAt: summary.updatedAt.toISOString(),
          })),
        },
        inferred: memories.map(presentMemory),
        exportedAt: now.toISOString(),
      });
    },
    async createGoal(userId, input) {
      return learnerGoalSchema.parse(
        await client.learnerGoal.create({
          data: { userProfileId: userId, ...input },
          select: { id: true, target: true, priority: true, state: true },
        }),
      );
    },
    async updateGoal(userId, id, input) {
      return client.$transaction(async (tx) => {
        const goal = await tx.learnerGoal.findFirst({ where: { id, userProfileId: userId } });
        if (goal === null) throw new HttpError(404, "Goal not found.");
        const updated = await tx.learnerGoal.update({
          where: { id_userProfileId: { id, userProfileId: userId } },
          data: input,
          select: { id: true, target: true, priority: true, state: true },
        });
        await tx.learnerMemory.updateMany({
          where: {
            userProfileId: userId,
            approvalState: "APPROVED",
            evidence: { some: { learnerGoalId: id } },
          },
          data: { approvalState: "PENDING", reviewedAt: null },
        });
        return learnerGoalSchema.parse(updated);
      });
    },
    async deleteGoal(userId, id) {
      await client.$transaction(async (tx) => {
        const goal = await tx.learnerGoal.findFirst({ where: { id, userProfileId: userId } });
        if (goal === null) throw new HttpError(404, "Goal not found.");
        const affected = await tx.learnerMemoryEvidence.findMany({
          where: { userProfileId: userId, learnerGoalId: id },
          select: { memoryId: true },
        });
        await tx.learnerGoal.delete({
          where: { id_userProfileId: { id, userProfileId: userId } },
        });
        await tx.learnerMemory.updateMany({
          where: {
            userProfileId: userId,
            id: { in: affected.map((item) => item.memoryId) },
            approvalState: "APPROVED",
          },
          data: { approvalState: "PENDING", reviewedAt: null },
        });
      });
    },
    async createTeachingPreference(userId, input) {
      return teachingPreferenceSchema.parse(
        await client.teachingPreference.create({
          data: { userProfileId: userId, ...input },
          select: { id: true, preference: true },
        }),
      );
    },
    async updateTeachingPreference(userId, id, input) {
      return client.$transaction(async (tx) => {
        const preference = await tx.teachingPreference.findFirst({
          where: { id, userProfileId: userId },
        });
        if (preference === null) throw new HttpError(404, "Teaching preference not found.");
        const updated = await tx.teachingPreference.update({
          where: { id_userProfileId: { id, userProfileId: userId } },
          data: input,
          select: { id: true, preference: true },
        });
        await tx.learnerMemory.updateMany({
          where: {
            userProfileId: userId,
            approvalState: "APPROVED",
            evidence: { some: { teachingPreferenceId: id } },
          },
          data: { approvalState: "PENDING", reviewedAt: null },
        });
        return teachingPreferenceSchema.parse(updated);
      });
    },
    async deleteTeachingPreference(userId, id) {
      await client.$transaction(async (tx) => {
        const preference = await tx.teachingPreference.findFirst({
          where: { id, userProfileId: userId },
        });
        if (preference === null) throw new HttpError(404, "Teaching preference not found.");
        const affected = await tx.learnerMemoryEvidence.findMany({
          where: { userProfileId: userId, teachingPreferenceId: id },
          select: { memoryId: true },
        });
        await tx.teachingPreference.delete({
          where: { id_userProfileId: { id, userProfileId: userId } },
        });
        await tx.learnerMemory.updateMany({
          where: {
            userProfileId: userId,
            id: { in: affected.map((item) => item.memoryId) },
            approvalState: "APPROVED",
          },
          data: { approvalState: "PENDING", reviewedAt: null },
        });
      });
    },
    async reviewMemory(userId, id, review, now) {
      const memory = await ownedMemory(userId, id);
      if (review.action === "APPROVE" && memory.evidence.length === 0)
        throw new HttpError(409, "An inference needs supporting evidence before approval.");
      const data =
        review.action === "CORRECT"
          ? review.correction
          : {
              approvalState:
                review.action === "APPROVE" ? ("APPROVED" as const) : ("REJECTED" as const),
              reviewedAt: now,
            };
      return presentMemory(
        await client.learnerMemory.update({
          where: { id_userProfileId: { id, userProfileId: userId } },
          data,
          select: memorySelect,
        }),
      );
    },
    async deleteMemory(userId, id) {
      await ownedMemory(userId, id);
      await client.learnerMemory.delete({
        where: { id_userProfileId: { id, userProfileId: userId } },
      });
    },
  };
}

export function createLearningContextRouter(
  store: LearningContextStore,
  clock = () => new Date(),
): Router {
  const router = Router();
  const idSchema = learningContextInferenceSchema.shape.id;
  router.get("/", async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.json(await store.read(getApplicationProfile(request).id, clock()));
  });
  router.post("/goals", async (request, response) => {
    const input = learnerGoalInputSchema.safeParse(request.body);
    if (!input.success) throw new HttpError(400, "Invalid goal.");
    response
      .status(201)
      .json(await store.createGoal(getApplicationProfile(request).id, input.data));
  });
  router.put("/goals/:id", async (request, response) => {
    const id = idSchema.safeParse(request.params.id);
    const input = learnerGoalInputSchema.safeParse(request.body);
    if (!id.success || !input.success) throw new HttpError(400, "Invalid goal.");
    response.json(await store.updateGoal(getApplicationProfile(request).id, id.data, input.data));
  });
  router.delete("/goals/:id", async (request, response) => {
    const id = idSchema.safeParse(request.params.id);
    if (!id.success) throw new HttpError(400, "Invalid goal identifier.");
    await store.deleteGoal(getApplicationProfile(request).id, id.data);
    response.status(204).end();
  });
  router.post("/teaching-preferences", async (request, response) => {
    const input = teachingPreferenceInputSchema.safeParse(request.body);
    if (!input.success) throw new HttpError(400, "Invalid teaching preference.");
    response
      .status(201)
      .json(await store.createTeachingPreference(getApplicationProfile(request).id, input.data));
  });
  router.put("/teaching-preferences/:id", async (request, response) => {
    const id = idSchema.safeParse(request.params.id);
    const input = teachingPreferenceInputSchema.safeParse(request.body);
    if (!id.success || !input.success) throw new HttpError(400, "Invalid teaching preference.");
    response.json(
      await store.updateTeachingPreference(getApplicationProfile(request).id, id.data, input.data),
    );
  });
  router.delete("/teaching-preferences/:id", async (request, response) => {
    const id = idSchema.safeParse(request.params.id);
    if (!id.success) throw new HttpError(400, "Invalid teaching preference identifier.");
    await store.deleteTeachingPreference(getApplicationProfile(request).id, id.data);
    response.status(204).end();
  });
  router.patch("/inferences/:id", async (request, response) => {
    const id = idSchema.safeParse(request.params.id);
    const review = memoryReviewSchema.safeParse(request.body);
    if (!id.success || !review.success) throw new HttpError(400, "Invalid inference review.");
    response.json(
      await store.reviewMemory(getApplicationProfile(request).id, id.data, review.data, clock()),
    );
  });
  router.delete("/inferences/:id", async (request, response) => {
    const id = idSchema.safeParse(request.params.id);
    if (!id.success) throw new HttpError(400, "Invalid inference identifier.");
    await store.deleteMemory(getApplicationProfile(request).id, id.data);
    response.status(204).end();
  });
  return router;
}
