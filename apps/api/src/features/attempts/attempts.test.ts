import { createServer, type Server } from "node:http";
import { confirmAttemptSchema, type Attempt } from "@practice-plus-plus/contracts";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../application/app.js";
import { createPrismaAttemptStore, type AttemptStore } from "./attempts.js";
import type { PrismaClient } from "../../shared/generated/prisma/client.js";

const userId = "25d64b95-b7cc-4fe5-91ac-ae296dc66383";
const problemId = "6931f7d2-86fc-43de-b7db-dcc636528fc1";
const attempt: Attempt = {
  review: null,
  id: "d3b65a55-1a50-43e1-82e0-e23a263925a5",
  type: "FRESH",
  practiceDate: "2026-09-06",
  startedAt: "2026-09-07T03:00:00.000Z",
  timerEndsAt: "2026-09-07T03:30:00.000Z",
  timerPausedAt: null,
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
  timerEndsAt: new Date(attempt.timerEndsAt!),
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
  it("authenticates review overrides and accepts only a valid date or reset", async () => {
    const { store } = database();
    const override = vi.spyOn(store, "overrideReview").mockResolvedValue(attempt);
    const url = `${await server(store)}/attempts/${attempt.id}/review`;
    expect((await fetch(url, { method: "PUT" })).status).toBe(401);
    for (const input of [
      {},
      { manualDueDate: "2026-02-30" },
      { manualDueDate: "" },
      { manualDueDate: "2026-09-10", userProfileId: userId },
      { manualDueDate: "2026-09-10", generatedDueDate: "2026-09-10" },
    ]) {
      expect(
        (await fetch(url, { method: "PUT", headers, body: JSON.stringify(input) })).status,
      ).toBe(400);
    }
    expect(override).not.toHaveBeenCalled();
    for (const manualDueDate of ["2026-09-10", null]) {
      expect(
        (await fetch(url, { method: "PUT", headers, body: JSON.stringify({ manualDueDate }) }))
          .status,
      ).toBe(200);
      expect(override).toHaveBeenLastCalledWith(userId, attempt.id, manualDueDate);
    }
  });
  it("authenticates history and rejects invalid or forged pagination", async () => {
    const { store } = database();
    const history = vi.spyOn(store, "history").mockResolvedValue({ attempts: [], next: null });
    const url = await server(store);
    expect((await fetch(`${url}/attempts`)).status).toBe(401);
    for (const query of [
      "userProfileId=other",
      "limit=1000",
      "before=invalid",
      `beforeId=${attempt.id}`,
      "before=2026-09-08T00:00:00.000Z&beforeId=invalid",
    ]) {
      expect((await fetch(`${url}/attempts?${query}`, { headers })).status).toBe(400);
    }
    expect(history).not.toHaveBeenCalled();
    expect((await fetch(`${url}/attempts`, { headers })).status).toBe(200);
    expect(history).toHaveBeenCalledExactlyOnceWith(userId, {});
  });
  it("authenticates result reporting and rejects incomplete or forged input", async () => {
    const { store } = database();
    const report = vi
      .spyOn(store, "report")
      .mockResolvedValue({ ...attempt, outcome: "INDEPENDENT", patterns: ["Arrays & Hashing"] });
    const url = await server(store);
    const path = `${url}/attempts/${attempt.id}/report-result`;
    expect((await fetch(path, { method: "POST" })).status).toBe(401);
    for (const body of [
      {},
      { outcome: "INCOMPLETE" },
      { outcome: "INDEPENDENT", userProfileId: "other" },
      { outcome: "INDEPENDENT", patterns: ["Trees"] },
    ]) {
      expect(
        (await fetch(path, { method: "POST", headers, body: JSON.stringify(body) })).status,
      ).toBe(400);
    }
    expect(report).not.toHaveBeenCalled();
    const response = await fetch(path, {
      method: "POST",
      headers,
      body: JSON.stringify({ outcome: "INDEPENDENT" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      outcome: "INDEPENDENT",
      confirmedAt: null,
      patterns: ["Arrays & Hashing"],
    });
    expect(report).toHaveBeenCalledExactlyOnceWith(userId, attempt.id, { outcome: "INDEPENDENT" });
  });
  it("authenticates confirmation and solution review, validates bodies, and passes only the verified owner", async () => {
    const store = {
      overrideReview: vi.fn(),
      history: vi.fn(),
      active: vi.fn(),
      start: vi.fn(),
      skip: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      report: vi.fn().mockResolvedValue(attempt),
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
      overrideReview: vi.fn(),
      history: vi.fn(),
      active: vi.fn().mockResolvedValue(attempt),
      start: vi.fn().mockResolvedValue(attempt),
      skip: vi.fn().mockResolvedValue(attempt),
      pause: vi.fn().mockResolvedValue(attempt),
      resume: vi.fn().mockResolvedValue(attempt),
      report: vi.fn().mockResolvedValue(attempt),
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
    expect(
      (await fetch(`${url}/attempts/${attempt.id}/pause-timer`, { method: "POST" })).status,
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
    await fetch(`${url}/attempts/${attempt.id}/pause-timer`, { method: "POST", headers });
    await fetch(`${url}/attempts/${attempt.id}/resume-timer`, { method: "POST", headers });
    expect(store.active).toHaveBeenCalledExactlyOnceWith(userId);
    expect(store.start).toHaveBeenCalledWith(userId, problemId, expect.any(Date));
    expect(store.skip).toHaveBeenCalledWith(userId, attempt.id, expect.any(Date));
    expect(store.pause).toHaveBeenCalledWith(userId, attempt.id, expect.any(Date));
    expect(store.resume).toHaveBeenCalledWith(userId, attempt.id, expect.any(Date));
  });
  it("rejects client-supplied ownership, type, practice date, and invalid identifiers", async () => {
    const store = {
      overrideReview: vi.fn(),
      history: vi.fn(),
      active: vi.fn(),
      start: vi.fn(),
      skip: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      report: vi.fn().mockResolvedValue(attempt),
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
    dailyPlan: { findUnique: vi.fn().mockResolvedValue(null) },
    dailyPlanItem: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() },
    reviewObligation: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    transferObligation: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    problemPattern: { findMany: vi.fn().mockResolvedValue([]) },
    $queryRaw: vi.fn().mockResolvedValue([]),
    attempt: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(record),
      update: vi.fn().mockResolvedValue(record),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    problem: { findFirst: vi.fn().mockResolvedValue({ id: problemId }) },
    practiceSettings: {
      findUnique: vi.fn().mockResolvedValue({
        timeZone: "America/Toronto",
        resetMinutes: 240,
        highIntervalDays: 1,
        mediumIntervalDays: 3,
        lowIntervalDays: 7,
        attemptTimerMinutes: 45,
      }),
    },
  };
  const client = {
    ...tx,
    $transaction: async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as PrismaClient;
  return { tx, store: createPrismaAttemptStore(client) };
}
describe("attempt persistence", () => {
  it.each(["INDEPENDENT", "ASSISTED"])(
    "uses automatic follow-up when a %s redo has no selected next action",
    async (outcome) => {
      const { tx, store } = database();
      tx.attempt.findFirst.mockResolvedValue({ ...record, type: "REDO" });
      const now = new Date("2026-09-10T12:00:00Z");
      await store.confirm(userId, attempt.id, confirmAttemptSchema.parse({ outcome }), now);
      const data = tx.attempt.update.mock.calls[0]?.[0].data;
      expect(data).toMatchObject({ outcome, confirmedAt: now });
      expect(data.nextAction).toBeUndefined();
      if (outcome === "ASSISTED") {
        expect(data.review.create).toEqual({
          urgency: "MEDIUM",
          generatedDueDate: new Date("2026-09-09T00:00:00Z"),
        });
      } else {
        expect(data.review).toBeUndefined();
      }
    },
  );
  it.each(["INDEPENDENT", "ASSISTED"])(
    "applies each accepted action for a %s redo without duplicate follow-up",
    async (outcome) => {
      for (const nextAction of [
        { type: "REPEAT" },
        { type: "CUSTOM_DATE", dueDate: "2026-10-01" },
        { type: "COMPLETE" },
        { type: "TRANSFER", pattern: "Arrays & Hashing" },
        { type: "TRANSFER", pattern: "Arrays & Hashing", dueDate: "2026-10-02" },
      ]) {
        const { tx, store } = database();
        tx.attempt.findFirst.mockResolvedValue({ ...record, type: "REDO" });
        tx.problemPattern.findMany.mockResolvedValue([
          { patternId: "pattern-id", pattern: { name: "Arrays & Hashing" } },
        ]);
        tx.practiceSettings.findUnique.mockResolvedValue({
          highIntervalDays: 2,
          mediumIntervalDays: 5,
          lowIntervalDays: 12,
        });
        const input = confirmAttemptSchema.parse({
          outcome,
          nextAction,
          assistance: outcome === "ASSISTED" ? [{ type: "DEBUGGING", hintLevel: null }] : [],
        });
        const now = new Date("2026-09-10T12:00:00Z");
        await store.confirm(userId, attempt.id, input, now);
        const data = tx.attempt.update.mock.calls[0]?.[0].data;
        expect(data).toMatchObject({ outcome, nextAction, confirmedAt: now });
        expect(data.assistance.create).toHaveLength(input.assistance.length);
        if (nextAction.type === "REPEAT" || nextAction.type === "CUSTOM_DATE") {
          expect(data.review.create).toEqual({
            urgency: outcome === "INDEPENDENT" ? "LOW" : "MEDIUM",
            generatedDueDate: new Date(
              outcome === "INDEPENDENT" ? "2026-09-18T00:00:00Z" : "2026-09-11T00:00:00Z",
            ),
            ...(nextAction.type === "CUSTOM_DATE"
              ? { manualDueDate: new Date("2026-10-01T00:00:00Z") }
              : {}),
          });
          expect(data.transfersCreated).toBeUndefined();
        } else {
          expect(data.review).toBeUndefined();
          if (nextAction.type === "TRANSFER") {
            expect(data.transfersCreated.create).toEqual({
              patternId: "pattern-id",
              generatedEligibleDate: new Date("2026-09-13T00:00:00Z"),
              ...(nextAction.dueDate
                ? { manualEligibleDate: new Date("2026-10-02T00:00:00Z") }
                : {}),
            });
            expect(tx.problemPattern.findMany).toHaveBeenCalledWith({
              where: { problemId, pattern: { name: "Arrays & Hashing" } },
              select: { patternId: true },
            });
          } else expect(data.transfersCreated).toBeUndefined();
        }
        tx.attempt.findFirst.mockResolvedValue({
          ...record,
          type: "REDO",
          outcome,
          confirmedAt: now,
          nextAction,
        });
        await store.confirm(userId, attempt.id, input, now);
        expect(tx.attempt.update).toHaveBeenCalledTimes(1);
        expect(tx.reviewObligation.updateMany).toHaveBeenCalledTimes(1);
        await expect(
          store.confirm(
            userId,
            attempt.id,
            confirmAttemptSchema.parse({
              ...input,
              nextAction:
                nextAction.type === "COMPLETE" ? { type: "REPEAT" } : { type: "COMPLETE" },
            }),
            now,
          ),
        ).rejects.toThrow("different next action");
      }
    },
  );
  it("rejects transfers to patterns outside the source problem", async () => {
    const { tx, store } = database();
    tx.attempt.findFirst.mockResolvedValue({ ...record, type: "REDO" });
    await expect(
      store.confirm(
        userId,
        attempt.id,
        confirmAttemptSchema.parse({
          outcome: "INDEPENDENT",
          nextAction: { type: "TRANSFER", pattern: "Trees" },
        }),
        new Date(),
      ),
    ).rejects.toThrow("Choose a pattern");
    expect(tx.attempt.update).not.toHaveBeenCalled();
    expect(tx.reviewObligation.updateMany).not.toHaveBeenCalled();
  });
  it.each(["GAVE_UP", "INCOMPLETE"])(
    "keeps automatic follow-up for %s redos and rejects a next action",
    async (outcome) => {
      const { tx, store } = database();
      tx.attempt.findFirst.mockResolvedValue({ ...record, type: "REDO" });
      await expect(
        store.confirm(
          userId,
          attempt.id,
          confirmAttemptSchema.parse({ outcome, nextAction: { type: "COMPLETE" } }),
          new Date(),
        ),
      ).rejects.toThrow("only to successful redos");
      await store.confirm(userId, attempt.id, confirmAttemptSchema.parse({ outcome }), new Date());
      expect(tx.attempt.update.mock.calls[0]?.[0].data.review.create.urgency).toBe("HIGH");
    },
  );
  it("rejects redo actions on fresh attempts", async () => {
    const { tx, store } = database();
    tx.attempt.findFirst.mockResolvedValue(record);
    await expect(
      store.confirm(
        userId,
        attempt.id,
        confirmAttemptSchema.parse({ outcome: "INDEPENDENT", nextAction: { type: "REPEAT" } }),
        new Date(),
      ),
    ).rejects.toThrow("only to successful redos");
    expect(tx.attempt.update).not.toHaveBeenCalled();
  });
  it("binds matching plan work and transfers when an attempt starts", async () => {
    const { tx, store } = database();
    tx.dailyPlan.findUnique.mockResolvedValue({
      practiceDate: new Date("2026-09-09T00:00:00Z"),
      timeZone: "UTC",
      resetMinutes: 0,
    });
    tx.dailyPlanItem.findFirst.mockResolvedValue({ id: "item", transferId: "transfer" });
    await store.start(userId, problemId, new Date("2026-09-09T12:00:00Z"));
    expect(tx.dailyPlanItem.findFirst).toHaveBeenCalledWith({
      where: { userProfileId: userId, problemId, attemptId: null },
    });
    expect(tx.dailyPlanItem.update).toHaveBeenCalledWith({
      where: { id: "item" },
      data: { attemptId: attempt.id },
    });
    expect(tx.transferObligation.updateMany).toHaveBeenCalledWith({
      where: {
        id: "transfer",
        attemptId: null,
        resolvedAt: null,
        sourceAttempt: { userProfileId: userId },
      },
      data: { attemptId: attempt.id },
    });
  });
  it("does not attach a new attempt to yesterday's plan", async () => {
    const { tx, store } = database();
    tx.dailyPlan.findUnique.mockResolvedValue({
      practiceDate: new Date("2026-09-08T00:00:00Z"),
      timeZone: "UTC",
      resetMinutes: 0,
    });
    await store.start(userId, problemId, new Date("2026-09-09T12:00:00Z"));
    expect(tx.dailyPlanItem.update).not.toHaveBeenCalled();
  });
  it("retires old reviews and fulfills bound transfers on confirmation only", async () => {
    const { tx, store } = database();
    tx.attempt.findFirst.mockResolvedValue(record);
    const now = new Date("2026-09-10T12:00:00Z");
    await store.confirm(
      userId,
      attempt.id,
      confirmAttemptSchema.parse({ outcome: "INCOMPLETE" }),
      now,
    );
    expect(tx.reviewObligation.updateMany).toHaveBeenCalledWith({
      where: {
        resolvedAt: null,
        sourceAttempt: { userProfileId: userId, problemId, id: { not: attempt.id } },
      },
      data: { resolvedAt: now },
    });
    expect(tx.transferObligation.updateMany).toHaveBeenCalledWith({
      where: { attemptId: attempt.id, resolvedAt: null, sourceAttempt: { userProfileId: userId } },
      data: { resolvedAt: now },
    });
    tx.attempt.findFirst.mockResolvedValue({ ...record, confirmedAt: now, outcome: "INCOMPLETE" });
    await store.confirm(
      userId,
      attempt.id,
      confirmAttemptSchema.parse({ outcome: "INCOMPLETE" }),
      now,
    );
    expect(tx.reviewObligation.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.transferObligation.updateMany).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["INDEPENDENT", null, null],
    ["ASSISTED", "MEDIUM", "2026-09-11"],
    ["GAVE_UP", "HIGH", "2026-09-08"],
    ["INCOMPLETE", "HIGH", "2026-09-08"],
  ] as const)(
    "creates review work atomically for %s using current intervals and the attempt date",
    async (outcome, urgency, due) => {
      const { tx, store } = database();
      tx.attempt.findFirst.mockResolvedValue(record);
      tx.practiceSettings.findUnique.mockResolvedValue({
        timeZone: "UTC",
        resetMinutes: 0,
        highIntervalDays: 2,
        mediumIntervalDays: 5,
        lowIntervalDays: 12,
      });
      await store.confirm(
        userId,
        attempt.id,
        confirmAttemptSchema.parse({ outcome }),
        new Date("2026-09-20T12:00:00Z"),
      );
      const data = tx.attempt.update.mock.calls[0]?.[0].data;
      expect(data.confirmedAt).toEqual(new Date("2026-09-20T12:00:00Z"));
      if (due === null) {
        expect(data).not.toHaveProperty("review");
      } else {
        expect(data.review).toEqual({
          create: { urgency, generatedDueDate: new Date(`${due}T00:00:00Z`) },
        });
        expect(tx.practiceSettings.findUnique).toHaveBeenCalledWith({
          where: { userProfileId: userId },
        });
      }
    },
  );
  it("includes previously recorded help in review urgency", async () => {
    const { tx, store } = database();
    tx.attempt.findFirst.mockResolvedValue({
      ...record,
      assistance: [{ type: "CONCEPTUAL_HINT", hintLevel: 1 }],
    });
    await store.confirm(
      userId,
      attempt.id,
      confirmAttemptSchema.parse({ outcome: "ASSISTED" }),
      new Date(),
    );
    expect(tx.attempt.update.mock.calls[0]?.[0].data.review.create.urgency).toBe("HIGH");
  });
  it("does not recalculate dates or lose overrides on repeated confirmation after settings change", async () => {
    const { tx, store } = database();
    const review = {
      generatedDueDate: new Date("2026-09-09T00:00:00Z"),
      manualDueDate: new Date("2026-09-15T00:00:00Z"),
    };
    tx.attempt.findFirst.mockResolvedValue({
      ...record,
      outcome: "ASSISTED",
      confirmedAt: new Date(),
      review,
    });
    tx.practiceSettings.findUnique.mockResolvedValue({
      timeZone: "UTC",
      resetMinutes: 0,
      highIntervalDays: 30,
      mediumIntervalDays: 40,
      lowIntervalDays: 50,
    });
    const result = await store.confirm(
      userId,
      attempt.id,
      confirmAttemptSchema.parse({ outcome: "ASSISTED" }),
      new Date(),
    );
    expect(result.review).toEqual({ generatedDueDate: "2026-09-09", manualDueDate: "2026-09-15" });
    expect(tx.practiceSettings.findUnique).not.toHaveBeenCalled();
    expect(tx.attempt.update).not.toHaveBeenCalled();
  });
  it("rejects confirmation without required settings before persisting", async () => {
    const { tx, store } = database();
    tx.attempt.findFirst.mockResolvedValue(record);
    tx.practiceSettings.findUnique.mockResolvedValue(null);
    await expect(
      store.confirm(
        userId,
        attempt.id,
        confirmAttemptSchema.parse({ outcome: "INCOMPLETE" }),
        new Date(),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(tx.attempt.update).not.toHaveBeenCalled();
  });
  it("changes only the manual date and permits returning to the generated date", async () => {
    const { tx, store } = database();
    tx.attempt.findFirst.mockResolvedValue({
      ...record,
      confirmedAt: new Date(),
      review: {
        generatedDueDate: new Date("2026-09-09T00:00:00Z"),
        manualDueDate: null,
      },
    });
    for (const date of ["2026-09-18", null]) {
      await store.overrideReview(userId, attempt.id, date);
      expect(tx.attempt.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { id: attempt.id, userProfileId: userId },
          data: {
            review: {
              update: { manualDueDate: date === null ? null : new Date(`${date}T00:00:00Z`) },
            },
          },
        }),
      );
    }
    expect(tx.practiceSettings.findUnique).not.toHaveBeenCalled();
  });
  it("rejects cross-user overrides and attempts without review work", async () => {
    const { tx, store } = database();
    await expect(store.overrideReview(userId, attempt.id, "2026-09-18")).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(tx.attempt.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: attempt.id, userProfileId: userId } }),
    );
    tx.attempt.findFirst.mockResolvedValue(record);
    await expect(store.overrideReview(userId, attempt.id, null)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(tx.attempt.update).not.toHaveBeenCalled();
  });
  it("bounds confirmed history, scopes every page to its owner, and excludes hidden fields", async () => {
    const { tx, store } = database();
    const confirmedAt = new Date("2026-09-08T12:00:00.000Z");
    const rows = Array.from({ length: 21 }, (_, index) => ({
      ...record,
      id: `d3b65a55-1a50-43e1-82e0-${String(100 - index).padStart(12, "0")}`,
      confirmedAt,
      outcome: "INCOMPLETE",
      approach: "Tracked the running total.",
      code: "must not be returned",
      problem: { ...record.problem, patterns: ["hidden"] },
    }));
    tx.attempt.findMany.mockResolvedValue(rows);
    const first = await store.history(userId, {});
    expect(first.attempts).toHaveLength(20);
    expect(first.next).toEqual({ before: confirmedAt.toISOString(), beforeId: rows[19]?.id });
    expect(first.attempts[0]).toMatchObject({
      outcome: "INCOMPLETE",
      approach: "Tracked the running total.",
    });
    expect(JSON.stringify(first)).not.toMatch(/hidden|must not be returned|patterns|"code"/);
    expect(tx.attempt.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { userProfileId: userId, confirmedAt: { not: null } },
        orderBy: [{ confirmedAt: "desc" }, { id: "desc" }],
        take: 21,
      }),
    );
    tx.attempt.findMany.mockResolvedValue([rows[20]]);
    const second = await store.history(userId, first.next ?? {});
    expect(second.attempts).toHaveLength(1);
    expect(second.next).toBeNull();
    expect(tx.attempt.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          userProfileId: userId,
          confirmedAt: { not: null },
          OR: [{ confirmedAt: { lt: confirmedAt } }, { confirmedAt, id: { lt: rows[19]?.id } }],
        },
      }),
    );
    tx.attempt.findMany.mockResolvedValue([]);
    expect(await store.history("another-owner", first.next ?? {})).toEqual({
      attempts: [],
      next: null,
    });
    expect(tx.attempt.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userProfileId: "another-owner",
          confirmedAt: { not: null },
        }),
      }),
    );
    expect(tx.problemPattern.findMany).not.toHaveBeenCalled();
  });
  it.each(["INDEPENDENT", "ASSISTED", "GAVE_UP"] as const)(
    "reports %s without confirmation and survives reload",
    async (outcome) => {
      const { tx, store } = database();
      tx.attempt.findFirst.mockResolvedValue(record);
      tx.attempt.update.mockResolvedValue({ ...record, outcome });
      tx.problemPattern.findMany.mockResolvedValue([{ pattern: { name: "Arrays & Hashing" } }]);
      const result = await store.report(userId, attempt.id, { outcome });
      expect(result).toMatchObject({ outcome, confirmedAt: null, patterns: ["Arrays & Hashing"] });
      expect(tx.attempt.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: attempt.id, userProfileId: userId },
          data: { outcome },
        }),
      );
      tx.attempt.findFirst.mockResolvedValue({ ...record, outcome });
      expect(await store.active(userId)).toEqual(result);
      expect(await store.report(userId, attempt.id, { outcome })).toEqual(result);
      expect(tx.attempt.update).toHaveBeenCalledTimes(1);
      await expect(
        store.confirm(
          userId,
          attempt.id,
          confirmAttemptSchema.parse({ outcome: "INCOMPLETE" }),
          new Date(),
        ),
      ).rejects.toMatchObject({ statusCode: 409 });
    },
  );

  it("queries tags only through the authenticated user's resolved problem history", async () => {
    const { tx, store } = database();
    tx.attempt.findFirst.mockResolvedValue(record);
    expect(await store.active(userId)).not.toHaveProperty("patterns");
    expect(tx.problemPattern.findMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        problemId,
        problem: {
          attempts: {
            some: {
              userProfileId: userId,
              outcome: { in: ["INDEPENDENT", "ASSISTED", "GAVE_UP"] },
            },
          },
        },
      },
      select: { pattern: { select: { name: true } } },
      orderBy: { pattern: { name: "asc" } },
    });
    tx.attempt.update.mockResolvedValue({
      ...record,
      outcome: "INCOMPLETE",
      confirmedAt: new Date(),
    });
    expect(
      await store.confirm(
        userId,
        attempt.id,
        confirmAttemptSchema.parse({ outcome: "INCOMPLETE" }),
        new Date(),
      ),
    ).not.toHaveProperty("patterns");
  });

  it("rejects reporting another user's attempt, confirmed attempts, and contradictory results", async () => {
    const { tx, store } = database();
    await expect(
      store.report(userId, attempt.id, { outcome: "INDEPENDENT" }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(tx.problemPattern.findMany).not.toHaveBeenCalled();
    for (const state of [
      { ...record, confirmedAt: new Date() },
      { ...record, outcome: "GAVE_UP" },
      { ...record, outcome: "ASSISTED" },
      { ...record, assistance: [{ type: "CONCEPTUAL_HINT", hintLevel: 1 }] },
    ]) {
      tx.attempt.findFirst.mockResolvedValue(state);
      await expect(
        store.report(userId, attempt.id, { outcome: "INDEPENDENT" }),
      ).rejects.toMatchObject({ statusCode: 409 });
    }
    expect(tx.attempt.update).not.toHaveBeenCalled();
  });
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
          data: {
            ...input,
            confirmedAt: now,
            assistance: { create: [] },
            review: {
              create: { urgency: "HIGH", generatedDueDate: new Date("2026-09-07T00:00:00Z") },
            },
          },
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
  it("allows an omitted reproduction report and rejects one without solution review", async () => {
    const { tx, store } = database();
    tx.attempt.findFirst.mockResolvedValue({
      ...record,
      assistance: [{ type: "SOLUTION_REVIEW", hintLevel: null }],
    });
    await store.confirm(
      userId,
      attempt.id,
      confirmAttemptSchema.parse({ outcome: "GAVE_UP" }),
      new Date(),
    );
    expect(tx.attempt.update.mock.calls[0]?.[0].data.reproducedFromMemory).toBeNull();
    tx.attempt.update.mockClear();
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
          review: {
            create: { urgency: "HIGH", generatedDueDate: new Date("2026-09-07T00:00:00Z") },
          },
          assistance: {
            create: [
              { type: "CONCEPTUAL_HINT", hintLevel: 2, source: "SELF_REPORTED", recordedAt: now },
            ],
          },
        },
      }),
    );
  });
  it("confirms an attempt with an existing unreviewed learning summary", async () => {
    const { tx, store } = database();
    tx.attempt.findFirst.mockResolvedValue({
      ...record,
      outcome: "INDEPENDENT",
      summary: {
        approach: null,
        stuckPoint: "Needed to identify the invariant.",
        misconception: null,
        assistance: "Used clarification.",
        progressTrigger: "Restated the conditions.",
        finalUnderstanding: null,
        nextTeachingAction: "Ask for the invariant.",
        reviewedAt: null,
      },
    });
    const summary = {
      approach: null,
      stuckPoint: "Needed to identify the invariant.",
      misconception: null,
      assistance: "Used clarification.",
      progressTrigger: "Restated the conditions.",
      finalUnderstanding: null,
      nextTeachingAction: "Ask for the invariant.",
    };
    const now = new Date();
    await store.confirm(
      userId,
      attempt.id,
      confirmAttemptSchema.parse({ outcome: "INDEPENDENT", summary }),
      now,
    );
    expect(tx.attempt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          summary: {
            upsert: {
              create: { ...summary, reviewedAt: now },
              update: { ...summary, reviewedAt: now },
            },
          },
        }),
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
            timerEndsAt: new Date("2026-09-07T03:45:00.000Z"),
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
  it("pauses and resumes without consuming paused time", async () => {
    const { tx, store } = database();
    const pausedAt = new Date("2026-09-07T03:10:00.000Z");
    const resumedAt = new Date("2026-09-07T03:15:00.000Z");
    const pausedRecord = { ...record, timerPausedAt: pausedAt };
    tx.attempt.findFirst.mockResolvedValueOnce(record);
    tx.attempt.update.mockResolvedValueOnce(pausedRecord);
    await expect(store.pause(userId, attempt.id, pausedAt)).resolves.toMatchObject({
      timerPausedAt: pausedAt.toISOString(),
    });
    expect(tx.attempt.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { timerPausedAt: pausedAt } }),
    );

    tx.attempt.findFirst.mockResolvedValueOnce(pausedRecord);
    tx.attempt.update.mockResolvedValueOnce({
      ...record,
      timerEndsAt: new Date("2026-09-07T03:35:00.000Z"),
    });
    await store.resume(userId, attempt.id, resumedAt);
    expect(tx.attempt.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: {
          timerEndsAt: new Date("2026-09-07T03:35:00.000Z"),
          timerPausedAt: null,
        },
      }),
    );
  });
});
