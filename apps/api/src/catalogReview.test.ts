import { createServer, type Server } from "node:http";

import type {
  CatalogImportBatchReview,
  CatalogProblemInput,
  CatalogPublishResponse,
  CatalogReviewActionResponse,
  CatalogReviewProblem,
} from "@practice-plus-plus/contracts";
import type { Express } from "express";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "./app.js";
import { createPrismaCatalogReviewStore, type CatalogReviewStore } from "./catalogReview.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import type { ApplicationProfile } from "./profile.js";

const servers: Server[] = [];
const administratorId = "61a6afc6-d4de-4a61-879c-7ca6bdb5f6b1";
const batchId = "2be016de-58c9-4ca2-8f96-8cc03c980958";
const problemId = "53a735b6-58cc-4ce3-b58a-44ac67ca23c2";
const now = new Date("2026-09-06T12:00:00.000Z");
const problemInput = {
  leetcodeId: 1,
  slug: "two-sum",
  title: "Two Sum",
  difficulty: "EASY",
  url: "https://leetcode.com/problems/two-sum/",
  availability: "AVAILABLE",
  patterns: ["Arrays & Hashing"],
} satisfies CatalogProblemInput;
const reviewProblem = {
  ...problemInput,
  id: problemId,
  importBatchId: batchId,
  published: false,
  publishedAt: null,
  publishedByUserProfileId: null,
  reviewedAt: null,
  reviewedByUserProfileId: null,
  reviewStatus: "DRAFT",
} satisfies CatalogReviewProblem;
const batchReview = {
  id: batchId,
  version: 1,
  source: { kind: "CURATED", name: "NeetCode 150" },
  createdAt: now.toISOString(),
  createdByUserProfileId: administratorId,
  problems: [reviewProblem],
} satisfies CatalogImportBatchReview;

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

function createReviewApp(role: ApplicationProfile["role"], store: CatalogReviewStore): Express {
  return createApp({
    authentication: {
      catalogReviewStore: store,
      profileStore: {
        resolveByAuthSubject: vi.fn().mockResolvedValue({
          authSubject: "a69bd27e-a95e-4ec5-9858-19dfc4b5e3c3",
          createdAt: now,
          id: administratorId,
          role,
          updatedAt: now,
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

function createReviewStore(overrides: Partial<CatalogReviewStore> = {}): CatalogReviewStore {
  return {
    editDraft: vi.fn().mockResolvedValue(reviewProblem),
    findBatch: vi.fn().mockResolvedValue(batchReview),
    publishApproved: vi.fn().mockResolvedValue({
      batchId,
      publishedAt: now.toISOString(),
      publishedByUserProfileId: administratorId,
      publishedCount: 1,
    } satisfies CatalogPublishResponse),
    reviewDraft: vi.fn().mockResolvedValue({
      problemId,
      reviewedAt: now.toISOString(),
      reviewedByUserProfileId: administratorId,
      reviewStatus: "APPROVED",
    } satisfies CatalogReviewActionResponse),
    ...overrides,
  };
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error === undefined ? resolve() : reject(error)));
        }),
    ),
  );
});

describe("catalog review routes", () => {
  it("lets an administrator inspect an import batch", async () => {
    const store = createReviewStore();
    const url = await startServer(createReviewApp("ADMINISTRATOR", store));
    const response = await fetch(`${url}/admin/catalog/imports/${batchId}`, {
      headers: { authorization: "Bearer valid-token" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(batchReview);
    expect(store.findBatch).toHaveBeenCalledWith(batchId);
  });

  it("edits a draft through a validated full replacement", async () => {
    const editDraft = vi.fn<CatalogReviewStore["editDraft"]>().mockResolvedValue(reviewProblem);
    const url = await startServer(
      createReviewApp("ADMINISTRATOR", createReviewStore({ editDraft })),
    );
    const response = await fetch(`${url}/admin/catalog/problems/${problemId}`, {
      body: JSON.stringify(problemInput),
      headers: { authorization: "Bearer valid-token", "content-type": "application/json" },
      method: "PUT",
    });

    expect(response.status).toBe(200);
    expect(editDraft).toHaveBeenCalledWith(problemId, problemInput);
  });

  it("records the administrator for approval and publication", async () => {
    const reviewDraft = vi.fn<CatalogReviewStore["reviewDraft"]>().mockResolvedValue({
      problemId,
      reviewedAt: now.toISOString(),
      reviewedByUserProfileId: administratorId,
      reviewStatus: "APPROVED",
    });
    const publishApproved = vi.fn<CatalogReviewStore["publishApproved"]>().mockResolvedValue({
      batchId,
      publishedAt: now.toISOString(),
      publishedByUserProfileId: administratorId,
      publishedCount: 1,
    });
    const url = await startServer(
      createReviewApp("ADMINISTRATOR", createReviewStore({ publishApproved, reviewDraft })),
    );

    const reviewResponse = await fetch(`${url}/admin/catalog/problems/${problemId}/review`, {
      body: JSON.stringify({ decision: "APPROVED" }),
      headers: { authorization: "Bearer valid-token", "content-type": "application/json" },
      method: "POST",
    });
    const publishResponse = await fetch(`${url}/admin/catalog/imports/${batchId}/publish`, {
      headers: { authorization: "Bearer valid-token" },
      method: "POST",
    });

    expect(reviewResponse.status).toBe(200);
    expect(publishResponse.status).toBe(200);
    expect(reviewDraft).toHaveBeenCalledWith({
      decision: "APPROVED",
      problemId,
      reviewedByUserProfileId: administratorId,
    });
    expect(publishApproved).toHaveBeenCalledWith(batchId, administratorId);
  });

  it("rejects invalid edits and ordinary users before calling the store", async () => {
    const editDraft = vi.fn<CatalogReviewStore["editDraft"]>();
    const administratorUrl = await startServer(
      createReviewApp("ADMINISTRATOR", createReviewStore({ editDraft })),
    );
    const userUrl = await startServer(createReviewApp("USER", createReviewStore({ editDraft })));

    const invalidResponse = await fetch(`${administratorUrl}/admin/catalog/problems/${problemId}`, {
      body: JSON.stringify({ ...problemInput, patterns: [] }),
      headers: { authorization: "Bearer valid-token", "content-type": "application/json" },
      method: "PUT",
    });
    const forbiddenResponse = await fetch(`${userUrl}/admin/catalog/problems/${problemId}`, {
      body: JSON.stringify(problemInput),
      headers: { authorization: "Bearer valid-token", "content-type": "application/json" },
      method: "PUT",
    });

    expect(invalidResponse.status).toBe(400);
    expect(forbiddenResponse.status).toBe(403);
    expect(editDraft).not.toHaveBeenCalled();
  });
});

describe("Prisma catalog review store", () => {
  it("replaces metadata and tags only for a draft", async () => {
    const transaction = {
      pattern: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: "22d2e255-9fd2-4d9e-a663-b2a1ebc2393f", name: "Arrays & Hashing" },
          ]),
      },
      problem: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ id: problemId, published: false, reviewStatus: "DRAFT" })
          .mockResolvedValueOnce(toDatabaseProblem()),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      problemPattern: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const client = {
      $transaction: vi.fn().mockImplementation((operation) => operation(transaction)),
    } as unknown as PrismaClient;
    const store = createPrismaCatalogReviewStore(client);

    await expect(store.editDraft(problemId, problemInput)).resolves.toEqual(reviewProblem);
    expect(transaction.problemPattern.deleteMany).toHaveBeenCalledWith({ where: { problemId } });
    expect(transaction.problem.updateMany).toHaveBeenCalledWith({
      where: { id: problemId, published: false, reviewStatus: "DRAFT" },
      data: expect.objectContaining({ leetcodeId: 1, slug: "two-sum", title: "Two Sum" }),
    });
    expect(transaction.problemPattern.createMany).toHaveBeenCalledWith({
      data: [{ patternId: "22d2e255-9fd2-4d9e-a663-b2a1ebc2393f", problemId: problemId }],
    });
  });

  it("moves a draft to a reviewed state with actor and time provenance", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const client = { problem: { updateMany } } as unknown as PrismaClient;
    const store = createPrismaCatalogReviewStore(client);

    await expect(
      store.reviewDraft({
        decision: "REJECTED",
        problemId,
        reviewedByUserProfileId: administratorId,
      }),
    ).resolves.toEqual({
      problemId,
      reviewedAt: now.toISOString(),
      reviewedByUserProfileId: administratorId,
      reviewStatus: "REJECTED",
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: problemId, published: false, reviewStatus: "DRAFT" },
      data: {
        reviewStatus: "REJECTED",
        reviewedAt: now,
        reviewedByUserProfileId: administratorId,
      },
    });
  });

  it("publishes only valid approved entries in the selected batch", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = {
      catalogImportBatch: { findUnique: vi.fn().mockResolvedValue({ id: batchId }) },
      problem: {
        findMany: vi.fn().mockResolvedValue([
          {
            ...toDatabaseProblem(),
            reviewStatus: "APPROVED",
            reviewedAt: now,
            reviewedByUserProfileId: administratorId,
          },
        ]),
        updateMany,
      },
    };
    const client = {
      $transaction: vi.fn().mockImplementation((operation) => operation(transaction)),
    } as unknown as PrismaClient;
    const store = createPrismaCatalogReviewStore(client);

    await expect(store.publishApproved(batchId, administratorId)).resolves.toEqual({
      batchId,
      publishedAt: now.toISOString(),
      publishedByUserProfileId: administratorId,
      publishedCount: 1,
    });
    expect(transaction.problem.findMany).toHaveBeenCalledWith({
      where: { importBatchId: batchId, published: false, reviewStatus: "APPROVED" },
      include: { problemPatterns: { include: { pattern: true } } },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: [problemId] }, published: false, reviewStatus: "APPROVED" },
      data: { published: true, publishedAt: now, publishedByUserProfileId: administratorId },
    });
  });

  it("refuses the entire publication when approved metadata is invalid", async () => {
    const updateMany = vi.fn();
    const transaction = {
      catalogImportBatch: { findUnique: vi.fn().mockResolvedValue({ id: batchId }) },
      problem: {
        findMany: vi.fn().mockResolvedValue([{ ...toDatabaseProblem(), problemPatterns: [] }]),
        updateMany,
      },
    };
    const client = {
      $transaction: vi.fn().mockImplementation((operation) => operation(transaction)),
    } as unknown as PrismaClient;
    const store = createPrismaCatalogReviewStore(client);

    await expect(store.publishApproved(batchId, administratorId)).rejects.toThrow(
      "Approved catalog entries failed publication validation",
    );
    expect(updateMany).not.toHaveBeenCalled();
  });
});

function toDatabaseProblem() {
  return {
    ...reviewProblem,
    reviewedAt: null,
    publishedAt: null,
    problemPatterns: [
      { pattern: { id: "22d2e255-9fd2-4d9e-a663-b2a1ebc2393f", name: "Arrays & Hashing" } },
    ],
  };
}
