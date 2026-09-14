import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "./generated/prisma/client.js";
import { createPrismaLearningContextStore } from "./learningContext.js";

const databaseUrl = process.env.LEARNER_CONTEXT_TEST_DATABASE_URL;
const schema = `learning_context_screen_test_${randomUUID().replaceAll("-", "")}`;
const userId = randomUUID();
const otherUserId = randomUUID();
const now = new Date("2026-09-14T12:00:00Z");

describe.skipIf(databaseUrl === undefined)("learning context screen database", () => {
  const sql = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }, { schema }),
  });
  const store = createPrismaLearningContextStore(db);
  let goalId: string;
  let preferenceId: string;
  let memoryId: string;

  beforeAll(async () => {
    await sql.connect();
    await sql.query(`CREATE SCHEMA "${schema}"`);
    await sql.query(`SET search_path TO "${schema}"`);
    const migrations = new URL("../prisma/migrations/", import.meta.url);
    for (const directory of (await readdir(migrations, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name)))
      await sql.query(
        await readFile(new URL(`${directory.name}/migration.sql`, migrations), "utf8"),
      );
    for (const id of [userId, otherUserId])
      await db.userProfile.create({ data: { id, authSubject: id } });
    const problem = await db.problem.create({
      data: {
        leetcodeId: 1,
        slug: "two-sum",
        title: "Two Sum",
        url: "https://leetcode.com/problems/two-sum/",
        difficulty: "EASY",
        reviewStatus: "APPROVED",
        published: true,
      },
    });
    const goal = await store.createGoal(userId, {
      target: "Prepare for interviews",
      priority: 0,
      state: "ACTIVE",
    });
    goalId = goal.id;
    const preference = await store.createTeachingPreference(userId, {
      preference: "Ask one question at a time.",
    });
    preferenceId = preference.id;
    const attempt = await db.attempt.create({
      data: {
        userProfileId: userId,
        problemId: problem.id,
        type: "FRESH",
        practiceDate: new Date("2026-09-13"),
        startedAt: new Date("2026-09-13T11:00:00Z"),
        confirmedAt: new Date("2026-09-13T12:00:00Z"),
        outcome: "ASSISTED",
      },
    });
    await db.assistanceEvent.create({
      data: { attemptId: attempt.id, type: "DEBUGGING", source: "SELF_REPORTED" },
    });
    const summary = await db.conversationSummary.create({
      data: {
        userProfileId: userId,
        mode: "COACH",
        topics: "Practice pacing",
        learningProgress: "Paused before implementation.",
      },
    });
    const memory = await db.learnerMemory.create({
      data: {
        userProfileId: userId,
        category: "Practice habit",
        content: "May benefit from pausing before implementation.",
        confidence: 0.7,
        lastObservedAt: now,
      },
    });
    memoryId = memory.id;
    await db.learnerMemoryEvidence.createMany({
      data: [
        { userProfileId: userId, memoryId, learnerGoalId: goal.id },
        { userProfileId: userId, memoryId, attemptId: attempt.id },
        { userProfileId: userId, memoryId, conversationSummaryId: summary.id },
      ],
    });
  }, 30000);

  afterAll(async () => {
    await db.$disconnect();
    try {
      await sql.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await sql.end();
    }
  });

  it("returns separated, user-scoped records with readable provenance", async () => {
    const context = await store.read(userId, now);
    expect(context.userSupplied.goals[0]?.target).toBe("Prepare for interviews");
    expect(context.userSupplied.teachingPreferences[0]?.preference).toBe(
      "Ask one question at a time.",
    );
    expect(context.observed.attempts).toEqual([
      expect.objectContaining({
        problemTitle: "Two Sum",
        outcome: "ASSISTED",
        assistance: ["DEBUGGING"],
      }),
    ]);
    expect(context.observed.summaries[0]?.topics).toBe("Practice pacing");
    expect(context.inferred[0]?.evidence.map((evidence) => evidence.type)).toEqual([
      "LEARNER_GOAL",
      "ATTEMPT",
      "CONVERSATION_SUMMARY",
    ]);
    const foreign = await store.read(otherUserId, now);
    expect(foreign.userSupplied.goals).toEqual([]);
    expect(foreign.inferred).toEqual([]);
  });

  it("reviews and corrects an inference without crossing tenants", async () => {
    await expect(
      store.reviewMemory(otherUserId, memoryId, { action: "APPROVE" }, now),
    ).rejects.toMatchObject({ statusCode: 404 });
    const approved = await store.reviewMemory(userId, memoryId, { action: "APPROVE" }, now);
    expect(approved.approvalState).toBe("APPROVED");
    const corrected = await store.reviewMemory(
      userId,
      memoryId,
      {
        action: "CORRECT",
        correction: {
          category: "Practice habit",
          content: "Benefits from stating an invariant before implementation.",
          confidence: 0.85,
          lifecycleState: "IMPROVING",
        },
      },
      now,
    );
    expect(corrected).toMatchObject({
      approvalState: "APPROVED",
      confidence: 0.85,
      lifecycleState: "IMPROVING",
    });
  });

  it("invalidates approval when a supporting declaration is deleted", async () => {
    await store.reviewMemory(userId, memoryId, { action: "APPROVE" }, now);
    await store.deleteGoal(userId, goalId);
    expect({
      goals: await db.learnerGoal.count({ where: { id: goalId } }),
      memory: await db.learnerMemory.findUnique({
        where: { id: memoryId },
        select: { approvalState: true, evidence: true },
      }),
    }).toEqual({ goals: 0, memory: expect.objectContaining({ approvalState: "PENDING" }) });
    await store.updateTeachingPreference(userId, preferenceId, {
      preference: "Lead with a question.",
    });
    expect((await store.read(userId, now)).userSupplied.teachingPreferences[0]?.preference).toBe(
      "Lead with a question.",
    );
  });
});
