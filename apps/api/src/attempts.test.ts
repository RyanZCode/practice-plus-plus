import { createServer, type Server } from "node:http";
import { confirmAttemptSchema, type Attempt } from "@practice-plus-plus/contracts";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { createPrismaAttemptStore, type AttemptStore } from "./attempts.js";
import type { PrismaClient } from "./generated/prisma/client.js";

const userId = "25d64b95-b7cc-4fe5-91ac-ae296dc66383";
const problemId = "6931f7d2-86fc-43de-b7db-dcc636528fc1";
const attempt: Attempt = {
  id: "d3b65a55-1a50-43e1-82e0-e23a263925a5",
  type: "FRESH",
  practiceDate: "2026-09-06",
  startedAt: "2026-09-07T03:00:00.000Z",
  timerSkippedAt: null,
  confirmedAt: null,
  solutionReviewedAt: null,
  outcome: null,
  confidence: null,
  optimality: null,
  timeSpentSeconds: null,
  approach: null,
  notes: null,
  reproducedFromMemory: null,
  assistance: [],
  problem: {
    id: problemId,
    leetcodeId: 1,
    title: "Two Sum",
    slug: "two-sum",
    url: "https://leetcode.com/problems/two-sum/",
    difficulty: "EASY",
    availability: "PAID_ONLY",
  },
};
const record = {
  ...attempt,
  practiceDate: new Date("2026-09-06T00:00:00Z"),
  startedAt: new Date(attempt.startedAt),
};
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});
async function server(store: AttemptStore) {
  const app = createApp({
    logger: pino({ level: "silent" }),
    authentication: {
      attemptStore: store,
      profileStore: {
        resolveByAuthSubject: vi.fn().mockResolvedValue({ id: userId, role: "USER" }),
      },
      verifier: { verify: vi.fn().mockResolvedValue({ subject: "subject" }) },
    },
  });
  const instance = createServer(app);
  servers.push(instance);
  await new Promise<void>((resolve) => instance.listen(0, "127.0.0.1", resolve));
  const address = instance.address();
  if (address === null || typeof address === "string") throw new Error("No port");
  return `http://127.0.0.1:${address.port}`;
}
const headers = { authorization: "Bearer test", "content-type": "application/json" };
describe("attempt routes", () => {
  it("authenticates confirmation and solution review, validates bodies, and passes only the verified owner", async () => {
    const store = {
      active: vi.fn(),
      start: vi.fn(),
      skip: vi.fn(),
      reviewSolution: vi.fn().mockResolvedValue(attempt),
      confirm: vi.fn().mockResolvedValue(attempt),
    };
    const url = await server(store);
    for (const path of ["confirm", "review-solution"]) {
      expect(
        (await fetch(`${url}/attempts/${attempt.id}/${path}`, { method: "POST" })).status,
      ).toBe(401);
      expect(
        (
          await fetch(`${url}/attempts/invalid/${path}`, {
            method: "POST",
            headers,
            body: JSON.stringify({ giveUp: true, outcome: "INDEPENDENT" }),
          })
        ).status,
      ).toBe(400);
    }
    for (const body of [{}, { giveUp: false }, { giveUp: true, userProfileId: userId }]) {
      expect(
        (
          await fetch(`${url}/attempts/${attempt.id}/review-solution`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
          })
        ).status,
      ).toBe(400);
    }
    for (const body of [
      {},
      { outcome: "REDO" },
      { outcome: "INDEPENDENT", code: "private code" },
      { outcome: "INDEPENDENT", userProfileId: userId },
    ]) {
      expect(
        (
          await fetch(`${url}/attempts/${attempt.id}/confirm`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
          })
        ).status,
      ).toBe(400);
    }
    expect(store.confirm).not.toHaveBeenCalled();
    expect(store.reviewSolution).not.toHaveBeenCalled();
    const reviewed = await fetch(`${url}/attempts/${attempt.id}/review-solution`, {
      method: "POST",
      headers,
      body: JSON.stringify({ giveUp: true }),
    });
    expect(reviewed.status).toBe(200);
    expect(store.reviewSolution).toHaveBeenCalledExactlyOnceWith(
      userId,
      attempt.id,
      expect.any(Date),
    );
    const confirmed = await fetch(`${url}/attempts/${attempt.id}/confirm`, {
      method: "POST",
      headers,
      body: JSON.stringify({ outcome: "INCOMPLETE" }),
    });
    expect(confirmed.status).toBe(200);
    expect(store.confirm).toHaveBeenCalledExactlyOnceWith(
      userId,
      attempt.id,
      confirmAttemptSchema.parse({ outcome: "INCOMPLETE" }),
      expect.any(Date),
    );
    const payload = await confirmed.text();
    expect(payload).not.toContain("patterns");
    expect(payload).not.toContain("userProfileId");
  });
  it("requires authentication and uses the verified profile for every operation", async () => {
    const store = {
      active: vi.fn().mockResolvedValue(attempt),
      start: vi.fn().mockResolvedValue(attempt),
      skip: vi.fn().mockResolvedValue(attempt),
      reviewSolution: vi.fn().mockResolvedValue(attempt),
      confirm: vi.fn().mockResolvedValue(attempt),
    };
    const url = await server(store);
    expect((await fetch(`${url}/attempts/active`)).status).toBe(401);
    expect(
      (
        await fetch(`${url}/attempts`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ problemId }),
        })
      ).status,
    ).toBe(401);
    expect(
      (await fetch(`${url}/attempts/${attempt.id}/skip-timer`, { method: "POST" })).status,
    ).toBe(401);
    const active = await fetch(`${url}/attempts/active`, { headers });
    expect(await active.json()).toEqual({ attempt });
    const started = await fetch(`${url}/attempts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ problemId }),
    });
    expect(await started.json()).toEqual(attempt);
    await fetch(`${url}/attempts/${attempt.id}/skip-timer`, { method: "POST", headers });
    expect(store.active).toHaveBeenCalledExactlyOnceWith(userId);
    expect(store.start).toHaveBeenCalledWith(userId, problemId, expect.any(Date));
    expect(store.skip).toHaveBeenCalledWith(userId, attempt.id, expect.any(Date));
  });
  it("rejects client-supplied ownership, type, practice date, and invalid identifiers", async () => {
    const store = {
      active: vi.fn(),
      start: vi.fn(),
      skip: vi.fn(),
      reviewSolution: vi.fn(),
      confirm: vi.fn(),
    };
    const url = await server(store);
    for (const extra of [
      { userProfileId: userId },
      { type: "REDO" },
      { practiceDate: "2026-09-01" },
      { problemId: "invalid" },
    ]) {
      expect(
        (
          await fetch(`${url}/attempts`, {
            method: "POST",
            headers,
            body: JSON.stringify({ problemId, ...extra }),
          })
        ).status,
      ).toBe(400);
    }
    expect(
      (await fetch(`${url}/attempts/invalid/skip-timer`, { method: "POST", headers })).status,
    ).toBe(400);
    expect(store.start).not.toHaveBeenCalled();
    expect(store.skip).not.toHaveBeenCalled();
  });
});
function database() {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    attempt: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(record),
      update: vi.fn().mockResolvedValue(record),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    problem: { findFirst: vi.fn().mockResolvedValue({ id: problemId }) },
    practiceSettings: {
      findUnique: vi.fn().mockResolvedValue({ timeZone: "America/Toronto", resetMinutes: 240 }),
    },
  };
  const client = {
    ...tx,
    $transaction: async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as PrismaClient;
  return { tx, store: createPrismaAttemptStore(client) };
}
describe("attempt persistence", () => {
  it("records explicit give-up and solution provenance once without confirming", async () => {
    const { tx, store } = database();
    tx.attempt.findFirst.mockResolvedValue(record);
    const now = new Date();
    await store.reviewSolution(userId, attempt.id, now);
    expect(tx.attempt.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: attempt.id, userProfileId: userId } }),
    );
    expect(tx.attempt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          outcome: "GAVE_UP",
          solutionReviewedAt: now,
          assistance: {
            create: { type: "SOLUTION_REVIEW", source: "LEETCODE_SOLUTION", recordedAt: now },
          },
        },
      }),
    );
    tx.attempt.findFirst.mockResolvedValue({ ...record, solutionReviewedAt: now });
    await store.reviewSolution(userId, attempt.id, now);
    expect(tx.attempt.update).toHaveBeenCalledTimes(1);
  });
  it.each(["INDEPENDENT", "ASSISTED", "INCOMPLETE"])(
    "rejects %s after solution review",
    async (outcome) => {
      const { tx, store } = database();
      tx.attempt.findFirst.mockResolvedValue({
        ...record,
        outcome: "GAVE_UP",
        assistance: [{ type: "SOLUTION_REVIEW", hintLevel: null }],
      });
      await expect(
        store.confirm(
          userId,
          attempt.id,
          confirmAttemptSchema.parse({ outcome, reproducedFromMemory: true }),
          new Date(),
        ),
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(tx.attempt.update).not.toHaveBeenCalled();
    },
  );
  it.each([true, false])(
    "confirms gave-up with reproduction %s and keeps confirmed submissions immutable",
    async (reproducedFromMemory) => {
      const { tx, store } = database();
      const reviewed = {
        ...record,
        outcome: "GAVE_UP",
        assistance: [{ type: "SOLUTION_REVIEW", hintLevel: null }],
      };
      tx.attempt.findFirst.mockResolvedValue(reviewed);
      const input = confirmAttemptSchema.parse({ outcome: "GAVE_UP", reproducedFromMemory });
      const now = new Date();
      await store.confirm(userId, attempt.id, input, now);
      expect(tx.attempt.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { ...input, confirmedAt: now, assistance: { create: [] } },
        }),
      );
      tx.attempt.findFirst.mockResolvedValue({
        ...reviewed,
        ...input,
        assistance: reviewed.assistance,
        confirmedAt: now,
      });
      await store.confirm(userId, attempt.id, input, new Date());
      expect(tx.attempt.update).toHaveBeenCalledTimes(1);
    },
  );
  it("requires a reproduction report and rejects one without solution review", async () => {
    const { tx, store } = database();
    tx.attempt.findFirst.mockResolvedValue({
      ...record,
      assistance: [{ type: "SOLUTION_REVIEW", hintLevel: null }],
    });
    await expect(
      store.confirm(
        userId,
        attempt.id,
        confirmAttemptSchema.parse({ outcome: "GAVE_UP" }),
        new Date(),
      ),
    ).rejects.toThrow("reproduce");
    tx.attempt.findFirst.mockResolvedValue(record);
    await expect(
      store.confirm(
        userId,
        attempt.id,
        confirmAttemptSchema.parse({ outcome: "INDEPENDENT", reproducedFromMemory: true }),
        new Date(),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(tx.attempt.update).not.toHaveBeenCalled();
  });
  it("rejects a different outcome after confirmation", async () => {
    const { tx, store } = database();
    tx.attempt.findFirst.mockResolvedValue({
      ...record,
      outcome: "INCOMPLETE",
      confirmedAt: new Date(),
    });
    await expect(
      store.confirm(
        userId,
        attempt.id,
        confirmAttemptSchema.parse({ outcome: "INDEPENDENT" }),
        new Date(),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(tx.attempt.update).not.toHaveBeenCalled();
  });
  it.each(["CONCEPTUAL_HINT", "DEBUGGING", "OPTIMIZATION"])(
    "rejects independent with recorded or reported %s",
    async (type) => {
      const { tx, store } = database();
      const assistance = [{ type, hintLevel: type === "CONCEPTUAL_HINT" ? 2 : null }];
      tx.attempt.findFirst.mockResolvedValue({ ...record, assistance });
      await expect(
        store.confirm(
          userId,
          attempt.id,
          confirmAttemptSchema.parse({ outcome: "INDEPENDENT" }),
          new Date(),
        ),
      ).rejects.toMatchObject({ statusCode: 409 });
      tx.attempt.findFirst.mockResolvedValue(record);
      await expect(
        store.confirm(
          userId,
          attempt.id,
          confirmAttemptSchema.parse({ outcome: "INDEPENDENT", assistance }),
          new Date(),
        ),
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(tx.attempt.update).not.toHaveBeenCalled();
    },
  );
  it("saves optional evidence and confirmation together without code or patterns", async () => {
    const { tx, store } = database();
    tx.attempt.findFirst.mockResolvedValue(record);
    const input = confirmAttemptSchema.parse({
      outcome: "ASSISTED",
      confidence: "SHAKY",
      optimality: "SUBOPTIMAL",
      timeSpentSeconds: 600,
      approach: "Compared pairs",
      notes: "Missed duplicate values",
      assistance: [{ type: "CONCEPTUAL_HINT", hintLevel: 2 }],
    });
    const now = new Date();
    await store.confirm(userId, attempt.id, input, now);
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.attempt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: attempt.id, userProfileId: userId },
        data: {
          ...input,
          confirmedAt: now,
          assistance: {
            create: [
              { type: "CONCEPTUAL_HINT", hintLevel: 2, source: "SELF_REPORTED", recordedAt: now },
            ],
          },
        },
      }),
    );
  });
  it("does not expose or change another user's attempt by identifier", async () => {
    const { tx, store } = database();
    for (const action of [
      () => store.reviewSolution(userId, attempt.id, new Date()),
      () =>
        store.confirm(
          userId,
          attempt.id,
          confirmAttemptSchema.parse({ outcome: "INCOMPLETE" }),
          new Date(),
        ),
    ]) {
      await expect(action()).rejects.toMatchObject({ statusCode: 404 });
    }
    expect(tx.attempt.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: attempt.id, userProfileId: userId } }),
    );
    expect(tx.attempt.update).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    "derives type from confirmed user history (previous: %s) and calculates practice date",
    async (previous) => {
      const { tx, store } = database();
      tx.attempt.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(previous ? { id: "previous" } : null);
      const result = await store.start(userId, problemId, new Date(attempt.startedAt));
      expect(tx.$queryRaw).toHaveBeenCalled();
      expect(tx.problem.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: problemId, published: true, availability: { not: "UNAVAILABLE" } },
        }),
      );
      expect(tx.attempt.findFirst).toHaveBeenLastCalledWith({
        where: { userProfileId: userId, problemId, confirmedAt: { not: null } },
        select: { id: true },
      });
      expect(tx.attempt.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            userProfileId: userId,
            problemId,
            type: previous ? "REDO" : "FRESH",
            practiceDate: new Date("2026-09-06T00:00:00Z"),
            startedAt: new Date(attempt.startedAt),
          },
        }),
      );
      expect(result).toEqual(attempt);
      expect(JSON.stringify(tx.attempt.create.mock.calls)).not.toContain("problemPatterns");
    },
  );
  it("resumes the same problem and rejects a second active problem", async () => {
    const { tx, store } = database();
    tx.attempt.findFirst.mockResolvedValue(record);
    expect(await store.start(userId, problemId, new Date())).toEqual(attempt);
    await expect(store.start(userId, "other", new Date())).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(tx.attempt.create).not.toHaveBeenCalled();
  });
  it("rejects missing settings and ineligible problems", async () => {
    const { tx, store } = database();
    tx.problem.findFirst.mockResolvedValue(null);
    await expect(store.start(userId, problemId, new Date())).rejects.toThrow("Eligible problem");
    tx.practiceSettings.findUnique.mockResolvedValue(null);
    await expect(store.start(userId, problemId, new Date())).rejects.toThrow("practice settings");
    expect(tx.attempt.create).not.toHaveBeenCalled();
  });
  it("scopes skip and active reads to the owner and preserves the original skip timestamp", async () => {
    const { tx, store } = database();
    expect(await store.active(userId)).toBeNull();
    expect(tx.attempt.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userProfileId: userId, confirmedAt: null } }),
    );
    await expect(store.skip(userId, attempt.id, new Date())).rejects.toThrow(
      "Active attempt not found",
    );
    expect(tx.attempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: attempt.id, userProfileId: userId, confirmedAt: null, timerSkippedAt: null },
      }),
    );
  });
});
