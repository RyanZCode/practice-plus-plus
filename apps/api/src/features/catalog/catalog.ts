import {
  catalogListQuerySchema,
  catalogPageSize,
  catalogProblemSchema,
  catalogProblemDetailsResponseSchema,
  catalogResponseSchema,
  type CatalogListQuery,
  type CatalogListProblem,
  type CatalogProblemDetailsResponse,
  type CatalogResponse,
  type CatalogProblem,
} from "@practice-plus-plus/contracts";
import { Router } from "express";

import { HttpError } from "../../shared/errors.js";
import { getApplicationProfile } from "../account/profile.js";
import type { Prisma, PrismaClient } from "../../shared/generated/prisma/client.js";

export const catalogProblemSelect = {
  id: true,
  leetcodeId: true,
  slug: true,
  title: true,
  difficulty: true,
  url: true,
  availability: true,
} as const;

export interface CatalogStore {
  listPublished(userProfileId: string, query: CatalogListQuery): Promise<CatalogResponse>;
  findPublished(problemId: string): Promise<CatalogProblem | null>;
  findSolvedDetails(
    userProfileId: string,
    problemId: string,
  ): Promise<CatalogProblemDetailsResponse | null>;
}

export function createPrismaCatalogStore(client: PrismaClient): CatalogStore {
  return {
    async listPublished(userProfileId, query) {
      const where = catalogWhere(userProfileId, query);
      const orderBy = catalogOrderBy(query);
      const [total, problems] = await Promise.all([
        client.problem.count({ where }),
        client.problem.findMany({
          where,
          select: catalogProblemSelect,
          orderBy,
          skip: query.page * catalogPageSize,
          take: catalogPageSize,
        }),
      ]);
      const solvedAttempts =
        problems.length === 0
          ? []
          : await client.attempt.findMany({
              where: {
                ...solvedAttemptFilter(userProfileId),
                problemId: { in: problems.map((problem) => problem.id) },
              },
              select: { problemId: true },
            });
      const solvedProblemIds = new Set(solvedAttempts.map((attempt) => attempt.problemId));

      return {
        problems: problems.map((problem) =>
          toCatalogListProblem(problem, solvedProblemIds.has(problem.id)),
        ),
        total,
        nextPage: (query.page + 1) * catalogPageSize < total ? query.page + 1 : null,
      };
    },
    async findPublished(problemId) {
      return client.problem.findFirst({
        where: { id: problemId, published: true },
        select: catalogProblemSelect,
      });
    },
    async findSolvedDetails(userProfileId, problemId) {
      const problem = await client.problem.findFirst({
        where: {
          id: problemId,
          published: true,
          attempts: {
            some: solvedAttemptFilter(userProfileId),
          },
        },
        select: {
          ...catalogProblemSelect,
          problemPatterns: {
            select: { pattern: { select: { name: true } } },
            orderBy: { pattern: { name: "asc" } },
          },
        },
      });
      if (problem === null) return null;
      return catalogProblemDetailsResponseSchema.parse({
        problem: toCatalogProblem(problem),
        patterns: problem.problemPatterns.map(({ pattern }) => pattern.name),
      });
    },
  };
}

export function createCatalogRouter(store: CatalogStore): Router {
  const router = Router();

  router.get("/problems", async (request, response) => {
    const query = parseCatalogListQuery(request.query);
    const page = await store.listPublished(getApplicationProfile(request).id, query);
    response.json(catalogResponseSchema.parse(page));
  });

  router.get("/problems/:problemId/details", async (request, response) => {
    const id = catalogProblemSchema.shape.id.safeParse(request.params.problemId);
    if (!id.success) {
      throw new HttpError(400, "Invalid catalog identifier");
    }

    const details = await store.findSolvedDetails(getApplicationProfile(request).id, id.data);
    if (details === null) {
      throw new HttpError(404, "Solved catalog problem not found");
    }

    response.json(catalogProblemDetailsResponseSchema.parse(details));
  });

  router.get("/problems/:problemId", async (request, response) => {
    const id = catalogProblemSchema.shape.id.safeParse(request.params.problemId);
    if (!id.success) {
      throw new HttpError(400, "Invalid catalog identifier");
    }

    const problem = await store.findPublished(id.data);
    if (problem === null) {
      throw new HttpError(404, "Catalog problem not found");
    }

    response.json(toCatalogProblem(problem));
  });

  return router;
}

function parseCatalogListQuery(rawQuery: unknown): CatalogListQuery {
  if (rawQuery === null || typeof rawQuery !== "object") {
    throw new HttpError(400, "Invalid catalog query");
  }

  const query = rawQuery as Record<string, unknown>;
  const parsed = catalogListQuerySchema.safeParse({
    query: readQueryString(query.query) ?? "",
    difficulty: readQueryList(query.difficulty),
    availability: readQueryList(query.availability),
    progress: readQueryList(query.progress),
    sort: readQueryString(query.sort) ?? "LEETCODE_ID",
    sortDirection: readQueryString(query.sortDirection) ?? "ASC",
    page: readQueryPage(query.page),
  });

  if (!parsed.success) {
    throw new HttpError(400, "Invalid catalog query");
  }

  return parsed.data;
}

function readQueryString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new HttpError(400, "Invalid catalog query");
  return value;
}

function readQueryList(value: unknown): string[] {
  if (value === undefined) return [];

  const values = Array.isArray(value) ? value : [value];
  if (!values.every((item) => typeof item === "string")) {
    throw new HttpError(400, "Invalid catalog query");
  }

  return values.flatMap((item) => item.split(",")).filter((item) => item !== "");
}

function readQueryPage(value: unknown): number {
  const stringValue = readQueryString(value);
  if (stringValue === undefined) return 0;

  const page = Number(stringValue);
  if (!Number.isInteger(page) || page < 0) throw new HttpError(400, "Invalid catalog query");
  return page;
}

function catalogWhere(userProfileId: string, query: CatalogListQuery): Prisma.ProblemWhereInput {
  const filters: Prisma.ProblemWhereInput[] = [{ published: true }];
  const numericQuery = /^\d+$/.test(query.query) ? Number(query.query) : null;

  if (query.query !== "") {
    filters.push(
      numericQuery === null
        ? { title: { contains: query.query, mode: "insensitive" } }
        : { leetcodeId: numericQuery },
    );
  }
  if (query.difficulty.length > 0) {
    filters.push({ difficulty: { in: query.difficulty } });
  }
  if (query.availability.length > 0) {
    filters.push({ availability: { in: query.availability } });
  }
  if (query.progress.length === 1) {
    filters.push({
      attempts:
        query.progress[0] === "SOLVED"
          ? { some: solvedAttemptFilter(userProfileId) }
          : { none: solvedAttemptFilter(userProfileId) },
    });
  }
  return filters.length === 1 ? filters[0]! : { AND: filters };
}

function solvedAttemptFilter(userProfileId: string): Prisma.AttemptWhereInput {
  return {
    userProfileId,
    confirmedAt: { not: null },
    outcome: { in: ["INDEPENDENT", "ASSISTED"] },
  };
}

function catalogOrderBy(query: CatalogListQuery): Prisma.ProblemOrderByWithRelationInput[] {
  const direction = query.sortDirection === "ASC" ? "asc" : "desc";
  const tieBreaker = { leetcodeId: direction } as const;

  if (query.sort === "TITLE") return [{ title: direction }, tieBreaker];
  if (query.sort === "DIFFICULTY") return [{ difficulty: direction }, tieBreaker];
  return [tieBreaker];
}

export function toCatalogProblem(problem: CatalogProblem): CatalogProblem {
  return catalogProblemSchema.parse({
    id: problem.id,
    leetcodeId: problem.leetcodeId,
    slug: problem.slug,
    title: problem.title,
    difficulty: problem.difficulty,
    url: problem.url,
    availability: problem.availability,
  });
}

function toCatalogListProblem(problem: CatalogProblem, solved: boolean): CatalogListProblem {
  return {
    ...toCatalogProblem(problem),
    solved,
  };
}
