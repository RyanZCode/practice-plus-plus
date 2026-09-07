import {
  catalogProblemSchema,
  catalogResponseSchema,
  type CatalogProblem,
} from "@practice-plus-plus/contracts";
import { Router } from "express";

import { HttpError } from "./errors.js";
import type { PrismaClient } from "./generated/prisma/client.js";

const catalogProblemSelect = {
  id: true,
  leetcodeId: true,
  slug: true,
  title: true,
  difficulty: true,
  url: true,
  availability: true,
} as const;

export interface CatalogStore {
  listPublished(): Promise<CatalogProblem[]>;
  findPublished(problemId: string): Promise<CatalogProblem | null>;
}

export function createPrismaCatalogStore(client: PrismaClient): CatalogStore {
  return {
    async listPublished() {
      return client.problem.findMany({
        where: { published: true },
        select: catalogProblemSelect,
        orderBy: { leetcodeId: "asc" },
      });
    },
    async findPublished(problemId) {
      return client.problem.findFirst({
        where: { id: problemId, published: true },
        select: catalogProblemSelect,
      });
    },
  };
}

export function createCatalogRouter(store: CatalogStore): Router {
  const router = Router();

  router.get("/problems", async (_request, response) => {
    const problems = await store.listPublished();
    response.json(catalogResponseSchema.parse({ problems: problems.map(toCatalogProblem) }));
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

function toCatalogProblem(problem: CatalogProblem): CatalogProblem {
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
