import { createServer, type Server } from "node:http";

import type { CatalogImportResponse, CatalogImportRow } from "@practice-plus-plus/contracts";
import type { Express } from "express";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../../application/app.js";
import { createPrismaCatalogImportStore, type CatalogImportStore } from "./catalogImport.js";
import type { PrismaClient } from "../../shared/generated/prisma/client.js";
import type { ApplicationProfile } from "../account/profile.js";

const servers: Server[] = [];
const batchId = "2be016de-58c9-4ca2-8f96-8cc03c980958";
const baseRow = {
  leetcodeId: 1,
  slug: "two-sum",
  title: "Two Sum",
  difficulty: "EASY",
  url: "https://leetcode.com/problems/two-sum/",
  patterns: ["Arrays & Hashing"],
} satisfies Omit<CatalogImportRow, "availability">;

async function startServer(app: Express): Promise<string> {
  const server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  servers.push(server);

  const address = server.address();

  if (address === null || typeof address === "string") {
    throw new Error("Test server did not start on a TCP port");
  }

  return `http://127.0.0.1:${address.port}`;
}

function createImportApp(role: ApplicationProfile["role"], store: CatalogImportStore): Express {
  return createApp({
    authentication: {
      catalogImportStore: store,
      profileStore: {
        resolveByAuthSubject: vi.fn().mockResolvedValue({
          authSubject: "a69bd27e-a95e-4ec5-9858-19dfc4b5e3c3",
          createdAt: new Date("2026-09-05T12:00:00Z"),
          id: "61a6afc6-d4de-4a61-879c-7ca6bdb5f6b1",
          role,
          updatedAt: new Date("2026-09-05T12:00:00Z"),
        }),
      },
      verifier: {
        verify: vi.fn().mockResolvedValue({
          subject: "a69bd27e-a95e-4ec5-9858-19dfc4b5e3c3",
        }),
      },
    },
    logger: pino({ level: "silent" }),
  });
}

async function postImport(url: string, rows: unknown[], sourceKind = "CURATED") {
  return fetch(`${url}/admin/catalog/imports`, {
    body: JSON.stringify({
      rows,
      source: { kind: sourceKind, name: "NeetCode 150" },
      version: 1,
    }),
    headers: {
      authorization: "Bearer valid-token",
      "content-type": "application/json",
    },
    method: "POST",
  });
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error === undefined ? resolve() : reject(error)));
        }),
    ),
  );
});

describe("catalog import route", () => {
  it("rejects an ordinary user before importing", async () => {
    const importDrafts = vi.fn<CatalogImportStore["importDrafts"]>();
    const url = await startServer(createImportApp("USER", { importDrafts }));
    const response = await postImport(url, [baseRow]);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
    expect(importDrafts).not.toHaveBeenCalled();
  });

  it("imports a valid administrator batch", async () => {
    const result: CatalogImportResponse = { batchId, errors: [], importedCount: 1 };
    const importDrafts = vi.fn<CatalogImportStore["importDrafts"]>().mockResolvedValue(result);
    const url = await startServer(createImportApp("ADMINISTRATOR", { importDrafts }));
    const response = await postImport(url, [baseRow], "LLM_GENERATED");

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(result);
    expect(importDrafts).toHaveBeenCalledWith({
      createdByUserProfileId: "61a6afc6-d4de-4a61-879c-7ca6bdb5f6b1",
      rows: [{ row: 1, value: { ...baseRow, availability: "AVAILABLE" } }],
      source: { kind: "LLM_GENERATED", name: "NeetCode 150" },
      version: 1,
    });
  });

  it("returns row-level validation and in-batch duplicate errors without importing", async () => {
    const importDrafts = vi.fn<CatalogImportStore["importDrafts"]>();
    const url = await startServer(createImportApp("ADMINISTRATOR", { importDrafts }));
    const response = await postImport(url, [
      baseRow,
      { ...baseRow, leetcodeId: 2, title: "" },
      { ...baseRow, leetcodeId: 3, title: "Another Problem" },
      {
        ...baseRow,
        slug: "contains-duplicate",
        title: "Contains Duplicate",
        url: "https://leetcode.com/problems/contains-duplicate/",
      },
    ]);
    const body = (await response.json()) as CatalogImportResponse;

    expect(response.status).toBe(422);
    expect(body.batchId).toBeNull();
    expect(body.importedCount).toBe(0);
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_ROW", row: 2 }),
        expect.objectContaining({ code: "DUPLICATE_SLUG", row: 3 }),
        expect.objectContaining({ code: "DUPLICATE_LEETCODE_ID", row: 4 }),
      ]),
    );
    expect(importDrafts).not.toHaveBeenCalled();
  });

  it("returns database duplicate errors without accepting the batch", async () => {
    const result: CatalogImportResponse = {
      batchId: null,
      errors: [{ code: "DUPLICATE_LEETCODE_ID", message: "LeetCode ID 1 already exists", row: 1 }],
      importedCount: 0,
    };
    const importDrafts = vi.fn<CatalogImportStore["importDrafts"]>().mockResolvedValue(result);
    const url = await startServer(createImportApp("ADMINISTRATOR", { importDrafts }));
    const response = await postImport(url, [baseRow]);

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual(result);
  });
});

describe("Prisma catalog import store", () => {
  it("persists imported rows as unpublished drafts with batch provenance", async () => {
    const createProblems = vi
      .fn()
      .mockResolvedValue([{ id: "53a735b6-58cc-4ce3-b58a-44ac67ca23c2", leetcodeId: 1 }]);
    const createProblemPatterns = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = {
      catalogImportBatch: { create: vi.fn().mockResolvedValue({ id: batchId }) },
      pattern: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: "22d2e255-9fd2-4d9e-a663-b2a1ebc2393f", name: "Arrays & Hashing" },
          ]),
      },
      problem: { createManyAndReturn: createProblems, findMany: vi.fn().mockResolvedValue([]) },
      problemPattern: { createMany: createProblemPatterns },
    };
    const client = {
      $transaction: vi.fn().mockImplementation((operation) => operation(transaction)),
    } as unknown as PrismaClient;
    const store = createPrismaCatalogImportStore(client);

    await expect(
      store.importDrafts({
        createdByUserProfileId: "61a6afc6-d4de-4a61-879c-7ca6bdb5f6b1",
        rows: [{ row: 1, value: { ...baseRow, availability: "AVAILABLE" } }],
        source: { kind: "LLM_GENERATED", name: "Generated catalog" },
        version: 1,
      }),
    ).resolves.toEqual({ batchId, errors: [], importedCount: 1 });
    expect(transaction.catalogImportBatch.create).toHaveBeenCalledWith({
      data: {
        createdByUserProfileId: "61a6afc6-d4de-4a61-879c-7ca6bdb5f6b1",
        formatVersion: 1,
        sourceKind: "LLM_GENERATED",
        sourceName: "Generated catalog",
      },
      select: { id: true },
    });
    expect(createProblems).toHaveBeenCalledWith({
      data: [
        {
          availability: "AVAILABLE",
          difficulty: "EASY",
          importBatchId: batchId,
          leetcodeId: 1,
          published: false,
          reviewStatus: "DRAFT",
          slug: "two-sum",
          title: "Two Sum",
          url: "https://leetcode.com/problems/two-sum/",
        },
      ],
      select: { id: true, leetcodeId: true },
    });
    expect(createProblemPatterns).toHaveBeenCalledWith({
      data: [
        {
          patternId: "22d2e255-9fd2-4d9e-a663-b2a1ebc2393f",
          problemId: "53a735b6-58cc-4ce3-b58a-44ac67ca23c2",
        },
      ],
    });
  });

  it("does not create a batch when database duplicates are found", async () => {
    const transaction = {
      catalogImportBatch: { create: vi.fn() },
      pattern: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: "22d2e255-9fd2-4d9e-a663-b2a1ebc2393f", name: "Arrays & Hashing" },
          ]),
      },
      problem: {
        createManyAndReturn: vi.fn(),
        findMany: vi.fn().mockResolvedValue([{ leetcodeId: 1, slug: "two-sum" }]),
      },
      problemPattern: { createMany: vi.fn() },
    };
    const client = {
      $transaction: vi.fn().mockImplementation((operation) => operation(transaction)),
    } as unknown as PrismaClient;
    const store = createPrismaCatalogImportStore(client);
    const result = await store.importDrafts({
      createdByUserProfileId: "61a6afc6-d4de-4a61-879c-7ca6bdb5f6b1",
      rows: [{ row: 1, value: { ...baseRow, availability: "AVAILABLE" } }],
      source: { kind: "CURATED", name: "NeetCode 150" },
      version: 1,
    });

    expect(result.errors).toEqual([
      { code: "DUPLICATE_LEETCODE_ID", message: "LeetCode ID 1 already exists", row: 1 },
      { code: "DUPLICATE_SLUG", message: "Slug two-sum already exists", row: 1 },
    ]);
    expect(transaction.catalogImportBatch.create).not.toHaveBeenCalled();
    expect(transaction.problem.createManyAndReturn).not.toHaveBeenCalled();
    expect(transaction.problemPattern.createMany).not.toHaveBeenCalled();
  });

  it("skips existing rows when requested", async () => {
    const createProblems = vi
      .fn()
      .mockResolvedValue([{ id: "53a735b6-58cc-4ce3-b58a-44ac67ca23c2", leetcodeId: 2 }]);
    const transaction = {
      catalogImportBatch: { create: vi.fn().mockResolvedValue({ id: batchId }) },
      pattern: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: "22d2e255-9fd2-4d9e-a663-b2a1ebc2393f", name: "Arrays & Hashing" },
          ]),
      },
      problem: {
        createManyAndReturn: createProblems,
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ leetcodeId: 1, slug: "two-sum" }])
          .mockResolvedValueOnce([]),
      },
      problemPattern: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const client = {
      $transaction: vi.fn().mockImplementation((operation) => operation(transaction)),
    } as unknown as PrismaClient;
    const store = createPrismaCatalogImportStore(client);

    const result = await store.importDrafts({
      createdByUserProfileId: "61a6afc6-d4de-4a61-879c-7ca6bdb5f6b1",
      rows: [
        { row: 1, value: { ...baseRow, availability: "AVAILABLE" } },
        {
          row: 2,
          value: {
            ...baseRow,
            availability: "AVAILABLE",
            leetcodeId: 2,
            slug: "two-sum-copy",
            title: "Two Sum Copy",
          },
        },
      ],
      skipExisting: true,
      source: { kind: "CURATED", name: "LeetCode CSV" },
      version: 1,
    });

    expect(result).toEqual({ batchId, errors: [], importedCount: 1 });
    expect(createProblems).toHaveBeenCalledWith({
      data: [expect.objectContaining({ leetcodeId: 2, slug: "two-sum-copy" })],
      select: { id: true, leetcodeId: true },
    });
  });
});
