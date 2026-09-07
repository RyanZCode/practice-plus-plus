import { createServer, type Server } from "node:http";

import { catalogProblemSchema, type CatalogProblem } from "@practice-plus-plus/contracts";
import type { Express } from "express";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "./app.js";
import { createPrismaCatalogStore, type CatalogStore } from "./catalog.js";
import type { PrismaClient } from "./generated/prisma/client.js";

const servers: Server[] = [];
const problem = {
  id: "53a735b6-58cc-4ce3-b58a-44ac67ca23c2",
  leetcodeId: 1,
  slug: "two-sum",
  title: "Two Sum",
  difficulty: "EASY",
  url: "https://leetcode.com/problems/two-sum/",
  availability: "AVAILABLE",
} satisfies CatalogProblem;
const hiddenProblem = {
  ...problem,
  patterns: ["Arrays & Hashing"],
  problemPatterns: [{ pattern: { name: "Arrays & Hashing", aliases: ["Hash Map"] } }],
  importBatchId: "2be016de-58c9-4ca2-8f96-8cc03c980958",
  sourceName: "Arrays & Hashing collection",
  reviewStatus: "APPROVED",
  published: true,
};
const headers = { authorization: "Bearer valid-token" };

function createStore(): CatalogStore {
  return {
    listPublished: vi.fn().mockResolvedValue([hiddenProblem]),
    findPublished: vi.fn().mockResolvedValue(hiddenProblem),
  };
}

function createCatalogApp(store: CatalogStore, role: "USER" | "ADMINISTRATOR" = "USER"): Express {
  return createApp({
    authentication: {
      catalogStore: store,
      catalogImportStore: {
        importDrafts: vi.fn(),
      },
      catalogReviewStore: {
        findBatch: vi.fn().mockResolvedValue({ problems: [hiddenProblem] }),
        editDraft: vi.fn().mockResolvedValue(hiddenProblem),
        reviewDraft: vi.fn(),
        publishApproved: vi.fn(),
      },
      profileStore: {
        resolveByAuthSubject: vi.fn().mockResolvedValue({
          id: "61a6afc6-d4de-4a61-879c-7ca6bdb5f6b1",
          role,
        }),
      },
      verifier: { verify: vi.fn().mockResolvedValue({ subject: "test-user" }) },
    },
    logger: pino({ level: "silent" }),
  });
}

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

describe("catalog disclosure", () => {
  it.each(["USER", "ADMINISTRATOR"] as const)(
    "returns only public metadata on learner routes for %s",
    async (role) => {
      const url = await startServer(createCatalogApp(createStore(), role));
      const query = "?include=patterns,problemPatterns,importBatch&reveal=true&role=ADMINISTRATOR";
      const list = await fetch(`${url}/catalog/problems${query}`, { headers });
      const detail = await fetch(`${url}/catalog/problems/${problem.id}${query}`, { headers });

      expect(list.status).toBe(200);
      expect(await list.json()).toEqual({ problems: [problem] });
      expect(detail.status).toBe(200);
      expect(await detail.json()).toEqual(problem);
    },
  );

  it("rejects hidden fields in the shared learner contract", () => {
    expect(catalogProblemSchema.safeParse(hiddenProblem).success).toBe(false);
    expect(catalogProblemSchema.safeParse(problem).success).toBe(true);
  });

  it("requires authentication before reading catalog data", async () => {
    const store = createStore();
    const url = await startServer(createCatalogApp(store));
    for (const path of ["/catalog/problems", `/catalog/problems/${problem.id}`]) {
      expect((await fetch(`${url}${path}`)).status).toBe(401);
    }
    expect(store.listPublished).not.toHaveBeenCalled();
    expect(store.findPublished).not.toHaveBeenCalled();
  });

  it("handles an empty catalog, missing problems, and invalid identifiers", async () => {
    const store = createStore();
    vi.mocked(store.listPublished).mockResolvedValue([]);
    vi.mocked(store.findPublished).mockResolvedValue(null);
    const url = await startServer(createCatalogApp(store));

    const list = await fetch(`${url}/catalog/problems`, { headers });
    expect(await list.json()).toEqual({ problems: [] });
    const missing = await fetch(`${url}/catalog/problems/${problem.id}`, { headers });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Catalog problem not found" });
    const invalid = await fetch(`${url}/catalog/problems/not-a-uuid`, { headers });
    expect(invalid.status).toBe(400);
    expect(store.findPublished).toHaveBeenCalledExactlyOnceWith(problem.id);
  });

  it.each([
    ["GET", `/admin/catalog/imports/${hiddenProblem.importBatchId}`],
    ["PUT", `/admin/catalog/problems/${problem.id}`],
    ["POST", `/admin/catalog/problems/${problem.id}/review`],
    ["POST", `/admin/catalog/imports/${hiddenProblem.importBatchId}/publish`],
    ["POST", "/admin/catalog/imports"],
  ])("blocks ordinary users from %s %s", async (method, path) => {
    const url = await startServer(createCatalogApp(createStore()));
    const response = await fetch(`${url}${path}?role=ADMINISTRATOR`, {
      method,
      headers: { ...headers, "x-user-role": "ADMINISTRATOR" },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
  });

  it.each(["/catalog/patterns", `/catalog/problems/${problem.id}/patterns`])(
    "does not expose a tag endpoint at %s",
    async (path) => {
      const url = await startServer(createCatalogApp(createStore()));
      const response = await fetch(`${url}${path}`, { headers });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Not found" });
    },
  );
});

describe("Prisma catalog store", () => {
  it("restricts list and identifier queries to published metadata without loading tags", async () => {
    const findMany = vi.fn().mockResolvedValue([problem]);
    const findFirst = vi.fn().mockResolvedValue(null);
    const store = createPrismaCatalogStore({
      problem: { findMany, findFirst },
    } as unknown as PrismaClient);
    const select = {
      id: true,
      leetcodeId: true,
      slug: true,
      title: true,
      difficulty: true,
      url: true,
      availability: true,
    };

    await expect(store.listPublished()).resolves.toEqual([problem]);
    await expect(store.findPublished(problem.id)).resolves.toBeNull();
    expect(findMany).toHaveBeenCalledWith({
      where: { published: true },
      select,
      orderBy: { leetcodeId: "asc" },
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: problem.id, published: true },
      select,
    });
  });
});
