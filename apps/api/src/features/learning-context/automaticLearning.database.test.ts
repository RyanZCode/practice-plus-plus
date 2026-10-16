import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../../shared/generated/prisma/client.js";
import { createPrismaLearningContextStore } from "./learningContext.js";
import { createPrismaSummaryStore } from "./summaries.js";
import { createPrismaContextAssembler } from "./context.js";

const databaseUrl = process.env.LEARNER_CONTEXT_TEST_DATABASE_URL;
const schema = `automatic_learning_test_${randomUUID().replaceAll("-", "")}`;
const userId = randomUUID();
const otherId = randomUUID();
const now = new Date("2026-10-15T20:00:00Z");
const output = {
  summary: {
    topics: "Boundary-case practice",
    learningProgress: "Traced empty inputs.",
    nextSteps: null,
  },
  attemptSummary: null,
  memorySuggestions: [
    {
      category: "Practice habit",
      content: "Benefits from tracing boundary cases.",
      confidence: 0.75,
      lifecycleState: "ACTIVE" as const,
    },
  ],
};

describe.skipIf(databaseUrl === undefined)("automatic learning persistence", () => {
  const sql = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  const db = new PrismaClient({
    adapter: new PrismaPg(
      { connectionString: databaseUrl, options: `-c search_path=${schema}` },
      { schema },
    ),
  });
  const summaries = createPrismaSummaryStore(db);
  const profile = createPrismaLearningContextStore(db);

  beforeAll(async () => {
    await sql.connect();
    await sql.query(`CREATE SCHEMA "${schema}"`);
    await sql.query(`SET search_path TO "${schema}"`);
    const migrations = new URL("../../../prisma/migrations/", import.meta.url);
    for (const entry of (await readdir(migrations, { withFileTypes: true }))
      .filter((item) => item.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name))) {
      await sql.query(await readFile(new URL(`${entry.name}/migration.sql`, migrations), "utf8"));
    }
    for (const id of [userId, otherId])
      await db.userProfile.create({
        data: {
          id,
          authSubject: id,
          practiceSettings: {
            create: {
              timeZone: "UTC",
              resetMinutes: 0,
              dailyTarget: 3,
              highIntervalDays: 1,
              mediumIntervalDays: 3,
              lowIntervalDays: 7,
            },
          },
        },
      });
  });
  afterAll(async () => {
    await db.$disconnect();
    await sql.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await sql.end();
  });

  it("automatically approves supported memories, records why and when, and retries without duplicating data", async () => {
    const checkpointId = randomUUID();
    const first = await summaries.save(
      userId,
      { mode: "COACH", attemptId: null, checkpointId },
      output,
      now,
    );
    expect(first.memorySuggestions[0]).toMatchObject({
      approvalState: "APPROVED",
      reviewedAt: now.toISOString(),
      approvalSource: "AUTOMATIC",
      approvalReason: expect.stringContaining("Coach checkpoint"),
    });
    const retry = await summaries.save(
      userId,
      { mode: "COACH", attemptId: null, checkpointId },
      output,
      now,
    );
    expect(retry).toEqual(first);
    expect(await db.conversationSummary.count({ where: { id: checkpointId } })).toBe(1);
    expect(await db.learnerMemory.count({ where: { userProfileId: userId } })).toBe(1);
    expect((await profile.read(userId, now)).inferred[0]).toMatchObject({
      approvalSource: "AUTOMATIC",
      approvalReason: expect.any(String),
      reviewedAt: now.toISOString(),
      evidence: [expect.objectContaining({ id: checkpointId })],
    });
    const packet = await createPrismaContextAssembler(db).assemble(
      userId,
      { policy: { mode: "COACH", purpose: "GENERAL" }, messages: [] },
      now,
    );
    expect(JSON.stringify(packet)).toContain(output.memorySuggestions[0]!.content);
    expect((await profile.read(otherId, now)).inferred).toEqual([]);
  });

  it("does not recreate duplicate or rejected inferences and permits deletion", async () => {
    await summaries.save(userId, { mode: "COACH", attemptId: null }, output, now);
    expect(await db.learnerMemory.count({ where: { userProfileId: userId } })).toBe(1);
    const memory = (await profile.read(userId, now)).inferred[0]!;
    await profile.reviewMemory(userId, memory.id, { action: "REJECT" }, now);
    const result = await summaries.save(userId, { mode: "COACH", attemptId: null }, output, now);
    expect(result.memorySuggestions).toEqual([]);
    expect((await profile.read(userId, now)).inferred[0]?.approvalState).toBe("REJECTED");
    await expect(profile.deleteMemory(otherId, memory.id)).rejects.toMatchObject({
      statusCode: 404,
    });
    await profile.deleteMemory(userId, memory.id);
    expect((await profile.read(userId, now)).inferred).toEqual([]);
    const packet = await createPrismaContextAssembler(db).assemble(
      userId,
      { policy: { mode: "COACH", purpose: "GENERAL" }, messages: [] },
      now,
    );
    expect(JSON.stringify(packet)).not.toContain(output.memorySuggestions[0]!.content);
  });

  it("deletes checkpoints and their unsupported memories without touching other users", async () => {
    const checkpointId = randomUUID();
    const saved = await summaries.save(
      userId,
      { mode: "COACH", attemptId: null, checkpointId },
      output,
      now,
    );
    await expect(profile.deleteSummary(otherId, checkpointId)).rejects.toMatchObject({
      statusCode: 404,
    });
    await profile.deleteSummary(userId, checkpointId);
    expect(await db.conversationSummary.count({ where: { id: checkpointId } })).toBe(0);
    expect(await db.learnerMemory.count({ where: { id: saved.memorySuggestions[0]!.id } })).toBe(0);
    await expect(profile.deleteSummary(userId, checkpointId)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("saves late tutor checkpoints without rewriting a confirmed attempt summary", async () => {
    const problem = await db.problem.create({
      data: {
        leetcodeId: 1,
        slug: "two-sum",
        title: "Two Sum",
        difficulty: "EASY",
        url: "https://leetcode.com/problems/two-sum/",
      },
    });
    const attempt = await db.attempt.create({
      data: {
        userProfileId: userId,
        problemId: problem.id,
        type: "FRESH",
        practiceDate: now,
        startedAt: now,
        timerEndsAt: now,
      },
    });
    const attemptSummary = {
      approach: "Traced the complements.",
      stuckPoint: null,
      misconception: null,
      assistance: null,
      progressTrigger: null,
      finalUnderstanding: null,
      nextTeachingAction: null,
    };
    await summaries.save(
      userId,
      { mode: "ATTEMPT_TUTOR", attemptId: attempt.id },
      { ...output, attemptSummary, memorySuggestions: [] },
      now,
    );
    await db.attempt.update({ where: { id: attempt.id }, data: { confirmedAt: now } });
    await db.attemptSummary.update({
      where: { attemptId: attempt.id },
      data: { approach: "Confirmed approach", reviewedAt: now },
    });
    const checkpointId = randomUUID();
    const late = await summaries.save(
      userId,
      { mode: "ATTEMPT_TUTOR", attemptId: attempt.id, checkpointId },
      { ...output, attemptSummary, memorySuggestions: [] },
      now,
    );
    expect(late.attemptSummary).toBeNull();
    expect(await db.attemptSummary.findUnique({ where: { attemptId: attempt.id } })).toMatchObject({
      approach: "Confirmed approach",
      reviewedAt: now,
    });
    await profile.deleteSummary(userId, checkpointId);
    expect(await db.attempt.findUnique({ where: { id: attempt.id } })).toMatchObject({
      confirmedAt: now,
    });
  });
});
