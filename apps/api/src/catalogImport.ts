import {
  catalogImportRequestSchema,
  catalogImportResponseSchema,
  catalogImportRowSchema,
  type CatalogImportError,
  type CatalogImportResponse,
  type CatalogImportRow,
  type CatalogImportSource,
} from "@practice-plus-plus/contracts";
import { Router } from "express";

import { HttpError } from "./errors.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { getApplicationProfile } from "./profile.js";

interface IndexedCatalogImportRow {
  readonly row: number;
  readonly value: CatalogImportRow;
}

export interface CatalogImportStore {
  importDrafts(input: {
    createdByUserProfileId: string;
    rows: readonly IndexedCatalogImportRow[];
    source: CatalogImportSource;
    version: 1;
  }): Promise<CatalogImportResponse>;
}

export function createPrismaCatalogImportStore(client: PrismaClient): CatalogImportStore {
  return {
    async importDrafts(input) {
      return client.$transaction(async (transaction) => {
        const patternNames = [...new Set(input.rows.flatMap(({ value }) => value.patterns))];
        const [patterns, existingProblems] = await Promise.all([
          transaction.pattern.findMany({
            select: { id: true, name: true },
            where: { name: { in: patternNames } },
          }),
          transaction.problem.findMany({
            select: { leetcodeId: true, slug: true },
            where: {
              OR: [
                { leetcodeId: { in: input.rows.map(({ value }) => value.leetcodeId) } },
                { slug: { in: input.rows.map(({ value }) => value.slug) } },
              ],
            },
          }),
        ]);
        const patternIds = new Map(patterns.map((pattern) => [pattern.name, pattern.id]));
        const errors = findDatabaseErrors(input.rows, existingProblems, patternIds);

        if (errors.length > 0) {
          return failureResponse(errors);
        }

        const batch = await transaction.catalogImportBatch.create({
          data: {
            createdByUserProfileId: input.createdByUserProfileId,
            formatVersion: input.version,
            sourceKind: input.source.kind,
            sourceName: input.source.name,
          },
          select: { id: true },
        });

        const createdProblems = await transaction.problem.createManyAndReturn({
          data: input.rows.map(({ value }) => ({
            availability: value.availability,
            difficulty: value.difficulty,
            importBatchId: batch.id,
            leetcodeId: value.leetcodeId,
            published: false,
            reviewStatus: "DRAFT",
            slug: value.slug,
            title: value.title,
            url: value.url,
          })),
          select: { id: true, leetcodeId: true },
        });
        const problemIds = new Map(
          createdProblems.map((problem) => [problem.leetcodeId, problem.id]),
        );

        await transaction.problemPattern.createMany({
          data: input.rows.flatMap(({ value }) =>
            value.patterns.map((patternName) => ({
              patternId: getPatternId(patternIds, patternName),
              problemId: getProblemId(problemIds, value.leetcodeId),
            })),
          ),
        });

        return catalogImportResponseSchema.parse({
          batchId: batch.id,
          errors: [],
          importedCount: input.rows.length,
        });
      });
    },
  };
}

export function createCatalogImportRouter(store: CatalogImportStore): Router {
  const router = Router();

  router.post("/", async (request, response) => {
    const parsedRequest = catalogImportRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      throw new HttpError(400, "Invalid catalog import");
    }

    const { errors, rows } = validateRows(parsedRequest.data.rows);

    if (errors.length > 0) {
      response.status(422).json(failureResponse(errors));
      return;
    }

    const result = catalogImportResponseSchema.parse(
      await store.importDrafts({
        createdByUserProfileId: getApplicationProfile(request).id,
        rows,
        source: parsedRequest.data.source,
        version: parsedRequest.data.version,
      }),
    );

    response.status(result.errors.length === 0 ? 201 : 422).json(result);
  });

  return router;
}

function validateRows(rows: readonly unknown[]): {
  errors: CatalogImportError[];
  rows: IndexedCatalogImportRow[];
} {
  const errors: CatalogImportError[] = [];
  const validRows: IndexedCatalogImportRow[] = [];
  const leetcodeIds = new Set<number>();
  const slugs = new Set<string>();

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const parsedRow = catalogImportRowSchema.safeParse(row);

    if (!parsedRow.success) {
      errors.push({
        code: "INVALID_ROW",
        message: parsedRow.error.issues
          .map((issue) => `${issue.path.join(".") || "row"}: ${issue.message}`)
          .join("; "),
        row: rowNumber,
      });
      return;
    }

    if (leetcodeIds.has(parsedRow.data.leetcodeId)) {
      errors.push({
        code: "DUPLICATE_LEETCODE_ID",
        message: `LeetCode ID ${parsedRow.data.leetcodeId} appears more than once in the batch`,
        row: rowNumber,
      });
    }

    if (slugs.has(parsedRow.data.slug)) {
      errors.push({
        code: "DUPLICATE_SLUG",
        message: `Slug ${parsedRow.data.slug} appears more than once in the batch`,
        row: rowNumber,
      });
    }

    leetcodeIds.add(parsedRow.data.leetcodeId);
    slugs.add(parsedRow.data.slug);
    validRows.push({ row: rowNumber, value: parsedRow.data });
  });

  return { errors, rows: validRows };
}

function findDatabaseErrors(
  rows: readonly IndexedCatalogImportRow[],
  existingProblems: readonly { leetcodeId: number; slug: string }[],
  patternIds: ReadonlyMap<string, string>,
): CatalogImportError[] {
  const errors: CatalogImportError[] = [];

  for (const { row, value } of rows) {
    if (existingProblems.some((problem) => problem.leetcodeId === value.leetcodeId)) {
      errors.push({
        code: "DUPLICATE_LEETCODE_ID",
        message: `LeetCode ID ${value.leetcodeId} already exists`,
        row,
      });
    }

    if (existingProblems.some((problem) => problem.slug === value.slug)) {
      errors.push({
        code: "DUPLICATE_SLUG",
        message: `Slug ${value.slug} already exists`,
        row,
      });
    }

    for (const patternName of value.patterns) {
      if (!patternIds.has(patternName)) {
        errors.push({
          code: "UNKNOWN_PATTERN",
          message: `Pattern ${patternName} is not configured`,
          row,
        });
      }
    }
  }

  return errors;
}

function failureResponse(errors: CatalogImportError[]): CatalogImportResponse {
  return catalogImportResponseSchema.parse({ batchId: null, errors, importedCount: 0 });
}

function getPatternId(patternIds: ReadonlyMap<string, string>, patternName: string): string {
  const patternId = patternIds.get(patternName);

  if (patternId === undefined) {
    throw new Error(`Pattern ${patternName} was not resolved before import`);
  }

  return patternId;
}

function getProblemId(problemIds: ReadonlyMap<number, string>, leetcodeId: number): string {
  const problemId = problemIds.get(leetcodeId);

  if (problemId === undefined) {
    throw new Error(`Problem ${leetcodeId} was not created during import`);
  }

  return problemId;
}
