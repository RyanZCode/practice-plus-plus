import {
  catalogImportBatchReviewSchema,
  catalogProblemInputSchema,
  catalogPublishResponseSchema,
  catalogReviewActionResponseSchema,
  catalogReviewDecisionRequestSchema,
  catalogReviewProblemSchema,
  type CatalogImportBatchReview,
  type CatalogProblemInput,
  type CatalogPublishResponse,
  type CatalogReviewActionResponse,
  type CatalogReviewProblem,
} from "@practice-plus-plus/contracts";
import { Router } from "express";

import { HttpError } from "./errors.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { getApplicationProfile } from "./profile.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ReviewInput {
  readonly problemId: string;
  readonly reviewedByUserProfileId: string;
  readonly decision: "APPROVED" | "REJECTED";
}

export interface CatalogReviewStore {
  findBatch(batchId: string): Promise<CatalogImportBatchReview | null>;
  editDraft(problemId: string, problem: CatalogProblemInput): Promise<CatalogReviewProblem>;
  reviewDraft(input: ReviewInput): Promise<CatalogReviewActionResponse>;
  publishApproved(
    batchId: string,
    publishedByUserProfileId: string,
  ): Promise<CatalogPublishResponse>;
}

export function createPrismaCatalogReviewStore(client: PrismaClient): CatalogReviewStore {
  return {
    async findBatch(batchId) {
      const batch = await client.catalogImportBatch.findUnique({
        where: { id: batchId },
        include: {
          problems: {
            orderBy: { leetcodeId: "asc" },
            include: { problemPatterns: { include: { pattern: true } } },
          },
        },
      });

      if (batch === null) {
        return null;
      }

      return catalogImportBatchReviewSchema.parse({
        id: batch.id,
        version: batch.formatVersion,
        source: { kind: batch.sourceKind, name: batch.sourceName },
        createdAt: batch.createdAt.toISOString(),
        createdByUserProfileId: batch.createdByUserProfileId,
        problems: batch.problems.map(toReviewProblem),
      });
    },

    async editDraft(problemId, problem) {
      return client.$transaction(async (transaction) => {
        const current = await transaction.problem.findUnique({
          where: { id: problemId },
          select: { id: true, published: true, reviewStatus: true },
        });

        if (current === null) {
          throw new HttpError(404, "Catalog problem not found");
        }

        if (current.reviewStatus !== "DRAFT" || current.published) {
          throw new HttpError(409, "Only unpublished drafts can be edited");
        }

        const [patterns, duplicate] = await Promise.all([
          transaction.pattern.findMany({
            where: { name: { in: problem.patterns } },
            select: { id: true, name: true },
          }),
          transaction.problem.findFirst({
            where: {
              id: { not: problemId },
              OR: [{ leetcodeId: problem.leetcodeId }, { slug: problem.slug }],
            },
            select: { leetcodeId: true, slug: true },
          }),
        ]);

        if (patterns.length !== problem.patterns.length) {
          throw new HttpError(422, "Catalog problem contains an unknown pattern");
        }

        if (duplicate !== null) {
          throw new HttpError(409, "LeetCode ID or slug already exists");
        }

        const patternIds = new Map(patterns.map((pattern) => [pattern.name, pattern.id]));

        const update = await transaction.problem.updateMany({
          where: { id: problemId, published: false, reviewStatus: "DRAFT" },
          data: {
            availability: problem.availability,
            difficulty: problem.difficulty,
            leetcodeId: problem.leetcodeId,
            slug: problem.slug,
            title: problem.title,
            url: problem.url,
          },
        });

        if (update.count === 0) {
          throw new HttpError(409, "Only unpublished drafts can be edited");
        }

        await transaction.problemPattern.deleteMany({ where: { problemId } });
        await transaction.problemPattern.createMany({
          data: problem.patterns.map((patternName) => ({
            patternId: getPatternId(patternIds, patternName),
            problemId,
          })),
        });

        const updated = await transaction.problem.findUnique({
          where: { id: problemId },
          include: { problemPatterns: { include: { pattern: true } } },
        });

        if (updated === null) {
          throw new Error("Edited catalog problem could not be reloaded");
        }

        return catalogReviewProblemSchema.parse(toReviewProblem(updated));
      });
    },

    async reviewDraft(input) {
      const reviewedAt = new Date();
      const result = await client.problem.updateMany({
        where: { id: input.problemId, published: false, reviewStatus: "DRAFT" },
        data: {
          reviewStatus: input.decision,
          reviewedAt,
          reviewedByUserProfileId: input.reviewedByUserProfileId,
        },
      });

      if (result.count === 0) {
        const existing = await client.problem.findUnique({
          where: { id: input.problemId },
          select: { id: true },
        });
        throw new HttpError(
          existing === null ? 404 : 409,
          existing === null ? "Catalog problem not found" : "Only drafts can be reviewed",
        );
      }

      return catalogReviewActionResponseSchema.parse({
        problemId: input.problemId,
        reviewStatus: input.decision,
        reviewedAt: reviewedAt.toISOString(),
        reviewedByUserProfileId: input.reviewedByUserProfileId,
      });
    },

    async publishApproved(batchId, publishedByUserProfileId) {
      return client.$transaction(async (transaction) => {
        const batch = await transaction.catalogImportBatch.findUnique({
          where: { id: batchId },
          select: { id: true },
        });

        if (batch === null) {
          throw new HttpError(404, "Catalog import batch not found");
        }

        const approved = await transaction.problem.findMany({
          where: { importBatchId: batchId, published: false, reviewStatus: "APPROVED" },
          include: { problemPatterns: { include: { pattern: true } } },
        });

        const invalid = approved.filter(
          (problem) =>
            !catalogProblemInputSchema.safeParse({
              availability: problem.availability,
              difficulty: problem.difficulty,
              leetcodeId: problem.leetcodeId,
              patterns: problem.problemPatterns.map(({ pattern }) => pattern.name),
              slug: problem.slug,
              title: problem.title,
              url: problem.url,
            }).success,
        );

        if (invalid.length > 0) {
          throw new HttpError(422, "Approved catalog entries failed publication validation");
        }

        if (approved.length === 0) {
          return catalogPublishResponseSchema.parse({
            batchId,
            publishedAt: null,
            publishedByUserProfileId: null,
            publishedCount: 0,
          });
        }

        const publishedAt = new Date();
        const result = await transaction.problem.updateMany({
          where: {
            id: { in: approved.map((problem) => problem.id) },
            published: false,
            reviewStatus: "APPROVED",
          },
          data: { published: true, publishedAt, publishedByUserProfileId },
        });

        return catalogPublishResponseSchema.parse({
          batchId,
          publishedAt: publishedAt.toISOString(),
          publishedByUserProfileId,
          publishedCount: result.count,
        });
      });
    },
  };
}

export function createCatalogReviewRouter(store: CatalogReviewStore): Router {
  const router = Router();

  router.get("/imports/:batchId", async (request, response) => {
    const batchId = parseId(request.params.batchId);
    const batch = await store.findBatch(batchId);

    if (batch === null) {
      throw new HttpError(404, "Catalog import batch not found");
    }

    response.json(catalogImportBatchReviewSchema.parse(batch));
  });

  router.put("/problems/:problemId", async (request, response) => {
    const problemId = parseId(request.params.problemId);
    const problem = catalogProblemInputSchema.safeParse(request.body);

    if (!problem.success) {
      throw new HttpError(400, "Invalid catalog problem");
    }

    response.json(catalogReviewProblemSchema.parse(await store.editDraft(problemId, problem.data)));
  });

  router.post("/problems/:problemId/review", async (request, response) => {
    const problemId = parseId(request.params.problemId);
    const review = catalogReviewDecisionRequestSchema.safeParse(request.body);

    if (!review.success) {
      throw new HttpError(400, "Invalid catalog review decision");
    }

    response.json(
      catalogReviewActionResponseSchema.parse(
        await store.reviewDraft({
          decision: review.data.decision,
          problemId,
          reviewedByUserProfileId: getApplicationProfile(request).id,
        }),
      ),
    );
  });

  router.post("/imports/:batchId/publish", async (request, response) => {
    const batchId = parseId(request.params.batchId);

    response.json(
      catalogPublishResponseSchema.parse(
        await store.publishApproved(batchId, getApplicationProfile(request).id),
      ),
    );
  });

  return router;
}

function parseId(id: string | undefined): string {
  if (id === undefined || !uuidPattern.test(id)) {
    throw new HttpError(400, "Invalid catalog identifier");
  }

  return id;
}

function getPatternId(patternIds: ReadonlyMap<string, string>, patternName: string): string {
  const patternId = patternIds.get(patternName);

  if (patternId === undefined) {
    throw new Error(`Pattern ${patternName} was not resolved before editing`);
  }

  return patternId;
}

function toReviewProblem(problem: {
  id: string;
  importBatchId: string | null;
  leetcodeId: number;
  slug: string;
  title: string;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  url: string;
  availability: "AVAILABLE" | "PAID_ONLY" | "UNAVAILABLE";
  reviewStatus: "DRAFT" | "APPROVED" | "REJECTED";
  published: boolean;
  reviewedAt: Date | null;
  reviewedByUserProfileId: string | null;
  publishedAt: Date | null;
  publishedByUserProfileId: string | null;
  problemPatterns: readonly { pattern: { name: string } }[];
}): CatalogReviewProblem {
  if (problem.importBatchId === null) {
    throw new Error("Catalog review problem is not associated with an import batch");
  }

  return catalogReviewProblemSchema.parse({
    id: problem.id,
    importBatchId: problem.importBatchId,
    leetcodeId: problem.leetcodeId,
    slug: problem.slug,
    title: problem.title,
    difficulty: problem.difficulty,
    url: problem.url,
    availability: problem.availability,
    patterns: problem.problemPatterns.map(({ pattern }) => pattern.name),
    reviewStatus: problem.reviewStatus,
    published: problem.published,
    reviewedAt: problem.reviewedAt?.toISOString() ?? null,
    reviewedByUserProfileId: problem.reviewedByUserProfileId,
    publishedAt: problem.publishedAt?.toISOString() ?? null,
    publishedByUserProfileId: problem.publishedByUserProfileId,
  });
}
