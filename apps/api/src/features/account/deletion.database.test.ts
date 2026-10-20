import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../../shared/generated/prisma/client.js";
import { createPrismaAccountDeletion } from "./deletion.js";
import { createPrismaProfileStore } from "./profile.js";

const databaseUrl = process.env.LEARNER_CONTEXT_TEST_DATABASE_URL;
const schema = `account_deletion_test_${randomUUID().replaceAll("-", "")}`;

describe.skipIf(databaseUrl === undefined)("account deletion database", () => {
  const sql = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  const db = new PrismaClient({
    adapter: new PrismaPg(
      { connectionString: databaseUrl, options: `-c search_path=${schema}` },
      { schema },
    ),
  });
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const day = new Date("2026-10-20");

  beforeAll(async () => {
    await sql.connect();
    await sql.query(`CREATE SCHEMA "${schema}"`);
    await sql.query(`SET search_path TO "${schema}"`);
    const migrations = new URL("../../../prisma/migrations/", import.meta.url);
    for (const directory of (await readdir(migrations, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name))) {
      await sql.query(
        await readFile(new URL(`${directory.name}/migration.sql`, migrations), "utf8"),
      );
    }
    const problem = await db.problem.create({
      data: {
        leetcodeId: 1,
        slug: "two-sum",
        title: "Two Sum",
        difficulty: "EASY",
        url: "https://leetcode.com/problems/two-sum/",
      },
    });
    for (const id of [userId, otherUserId]) {
      await db.userProfile.create({ data: { id, authSubject: id } });
      await db.practiceSettings.create({
        data: {
          userProfileId: id,
          timeZone: "UTC",
          resetMinutes: 240,
          dailyTarget: 2,
          highIntervalDays: 1,
          mediumIntervalDays: 3,
          lowIntervalDays: 7,
        },
      });
      const attempt = await db.attempt.create({
        data: {
          userProfileId: id,
          problemId: problem.id,
          type: "FRESH",
          practiceDate: day,
          startedAt: day,
          timerEndsAt: day,
        },
      });
      await db.assistanceEvent.create({
        data: { attemptId: attempt.id, type: "DEBUGGING", source: "SELF_REPORTED" },
      });
      await db.reviewObligation.create({
        data: { sourceAttemptId: attempt.id, urgency: "HIGH", generatedDueDate: day },
      });
      await db.attemptSummary.create({
        data: { attemptId: attempt.id, userProfileId: id, approach: "A saved approach" },
      });
      await db.attemptAssessmentDraft.create({
        data: {
          attemptId: attempt.id,
          userProfileId: id,
          outcome: "ASSISTED",
          evidence: ["Debugging assistance was recorded."],
        },
      });
      await db.dailyPlan.create({
        data: {
          userProfileId: id,
          practiceDate: day,
          target: 2,
          timeZone: "UTC",
          resetMinutes: 240,
          items: {
            create: { position: 0, problemId: problem.id, kind: "FRESH", reason: "FRESH_PRACTICE" },
          },
        },
      });
      await db.dailyCompletion.create({
        data: {
          userProfileId: id,
          practiceDate: day,
          requiredCount: 2,
          completedCount: 0,
          state: "ACTIVE",
        },
      });
      const goal = await db.learnerGoal.create({ data: { userProfileId: id, target: "Practice" } });
      await db.teachingPreference.create({
        data: { userProfileId: id, preference: "Small hints" },
      });
      await db.conversationSummary.create({
        data: { userProfileId: id, mode: "COACH", topics: "Review" },
      });
      const memory = await db.learnerMemory.create({
        data: {
          userProfileId: id,
          category: "Practice",
          content: "Review often",
          confidence: 0.7,
          lastObservedAt: day,
        },
      });
      await db.learnerMemoryEvidence.create({
        data: { memoryId: memory.id, userProfileId: id, learnerGoalId: goal.id },
      });
    }
  }, 30000);

  afterAll(async () => {
    await db.$disconnect();
    try {
      await sql.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await sql.end();
    }
  });

  it("removes personal records through cascades while preserving the other account and shared catalog", async () => {
    const security = await sql.query(
      "SELECT relrowsecurity FROM pg_class WHERE oid = 'account_deletions'::regclass",
    );
    expect(security.rows[0].relrowsecurity).toBe(true);
    await createPrismaAccountDeletion(db)(userId);
    const tables = [
      "user_profiles",
      "practice_settings",
      "attempts",
      "assistance_events",
      "review_obligations",
      "attempt_summaries",
      "attempt_assessment_drafts",
      "daily_plans",
      "daily_plan_items",
      "daily_completions",
      "learner_goals",
      "teaching_preferences",
      "conversation_summaries",
      "learner_memories",
      "learner_memory_evidence",
    ];
    for (const table of tables) {
      const result = await sql.query(`SELECT count(*)::int AS count FROM "${table}"`);
      expect(result.rows[0].count, table).toBe(1);
    }
    expect(await db.userProfile.findUnique({ where: { id: userId } })).toBeNull();
    expect(await db.userProfile.findUnique({ where: { id: otherUserId } })).not.toBeNull();
    expect(await db.problem.count()).toBe(1);
    expect(await db.accountDeletion.findUnique({ where: { authSubject: userId } })).toMatchObject({
      authSubject: userId,
      deletedAt: expect.any(Date),
    });
    await expect(createPrismaProfileStore(db).resolveByAuthSubject(userId)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("rolls back the deletion marker when an administrator cannot be deleted", async () => {
    const subject = randomUUID();
    await db.userProfile.create({ data: { authSubject: subject, role: "ADMINISTRATOR" } });
    await expect(createPrismaAccountDeletion(db)(subject)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await db.accountDeletion.findUnique({ where: { authSubject: subject } })).toBeNull();
    expect(await db.userProfile.findUnique({ where: { authSubject: subject } })).not.toBeNull();
  });

  it("does not recreate a profile when profile resolution overlaps deletion", async () => {
    const subject = randomUUID();
    await db.userProfile.create({ data: { authSubject: subject } });
    await Promise.allSettled([
      createPrismaProfileStore(db).resolveByAuthSubject(subject),
      createPrismaAccountDeletion(db)(subject),
    ]);
    await createPrismaAccountDeletion(db)(subject);
    await expect(createPrismaProfileStore(db).resolveByAuthSubject(subject)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await db.userProfile.findUnique({ where: { authSubject: subject } })).toBeNull();
  });
});
