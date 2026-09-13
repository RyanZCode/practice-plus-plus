import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "./generated/prisma/client.js";
import { createPrismaContextAssembler } from "./context.js";
import { createPrismaTutorStore } from "./tutor.js";

const databaseUrl = process.env.LEARNER_CONTEXT_TEST_DATABASE_URL;
const schema = `context_test_${randomUUID().replaceAll("-", "")}`;
const userId = randomUUID();
const otherUserId = randomUUID();
const now = new Date("2026-09-12T12:00:00Z");

describe.skipIf(databaseUrl === undefined)("context relational queries", () => {
  const sql = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }, { schema }),
  });
  const assembler = createPrismaContextAssembler(db);
  let activeId: string;
  let foreignId: string;
  let historyId: string;
  let approvedId: string;
  let freshId: string;

  beforeAll(async () => {
    await sql.connect();
    await sql.query(`CREATE SCHEMA "${schema}"`);
    await sql.query(`SET search_path TO "${schema}"`);
    const migrations = new URL("../prisma/migrations/", import.meta.url);
    for (const directory of (await readdir(migrations, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name)))
      await sql.query(
        await readFile(new URL(`${directory.name}/migration.sql`, migrations), "utf8"),
      );
    for (const id of [userId, otherUserId])
      await db.userProfile.create({
        data: {
          id,
          authSubject: id,
          practiceSettings: {
            create: {
              timeZone: "UTC",
              resetMinutes: 240,
              dailyTarget: 2,
              highIntervalDays: 1,
              mediumIntervalDays: 3,
              lowIntervalDays: 7,
            },
          },
        },
      });
    const tag = await db.pattern.findUniqueOrThrow({ where: { name: "Trees" } });
    const problems = [];
    for (let n = 1; n <= 3; n++)
      problems.push(
        await db.problem.create({
          data: {
            leetcodeId: n,
            slug: `problem-${n}`,
            title: `Problem ${n}`,
            url: `https://leetcode.com/problems/problem-${n}/`,
            difficulty: "EASY",
            published: true,
            reviewStatus: "APPROVED",
            problemPatterns: { create: { patternId: tag.id } },
          },
        }),
      );
    freshId = problems[2]!.id;
    const confirmed = await db.attempt.create({
      data: {
        userProfileId: userId,
        problemId: problems[0]!.id,
        type: "FRESH",
        practiceDate: new Date("2026-07-01"),
        startedAt: new Date("2026-07-01T12:00:00Z"),
        confirmedAt: new Date("2026-07-01T13:00:00Z"),
        outcome: "ASSISTED",
      },
    });
    historyId = confirmed.id;
    const active = await db.attempt.create({
      data: {
        userProfileId: userId,
        problemId: problems[1]!.id,
        type: "FRESH",
        practiceDate: new Date("2026-09-12"),
        startedAt: now,
      },
    });
    activeId = active.id;
    const foreign = await db.attempt.create({
      data: {
        userProfileId: otherUserId,
        problemId: problems[2]!.id,
        type: "FRESH",
        practiceDate: new Date("2026-09-12"),
        startedAt: now,
        confirmedAt: now,
        outcome: "ASSISTED",
      },
    });
    foreignId = foreign.id;
    await db.learnerGoal.create({
      data: { userProfileId: userId, target: "Prepare for interviews" },
    });
    await db.learnerGoal.create({ data: { userProfileId: otherUserId, target: "FOREIGN_GOAL" } });
    await db.teachingPreference.create({
      data: { userProfileId: userId, preference: "Ask one question at a time" },
    });
    await db.attemptSummary.create({
      data: {
        userProfileId: userId,
        attemptId: historyId,
        approach: "Tracked visited nodes",
        reviewedAt: now,
      },
    });
    await db.assistanceEvent.create({
      data: { attemptId: historyId, type: "DEBUGGING", source: "SELF_REPORTED" },
    });
    await db.reviewObligation.create({
      data: {
        sourceAttemptId: historyId,
        urgency: "HIGH",
        generatedDueDate: new Date("2026-09-01"),
      },
    });
    await db.conversationSummary.create({
      data: { userProfileId: userId, mode: "COACH", topics: "Coach continuity" },
    });
    await db.conversationSummary.create({
      data: {
        userProfileId: userId,
        mode: "ATTEMPT_TUTOR",
        attemptId: activeId,
        topics: "Tutor continuity",
      },
    });
    for (const [owner, attemptId, state, content] of [
      [userId, historyId, "APPROVED", "Approved observation"],
      [userId, historyId, "PENDING", "PENDING_SECRET"],
      [userId, historyId, "REJECTED", "REJECTED_SECRET"],
      [userId, activeId, "APPROVED", "UNCONFIRMED_SECRET"],
      [otherUserId, foreignId, "APPROVED", "FOREIGN_MEMORY"],
    ] as const) {
      const memory = await db.learnerMemory.create({
        data: {
          userProfileId: owner,
          category: "Understanding",
          content,
          confidence: 0.7,
          lastObservedAt: new Date("2026-07-01"),
          lifecycleState: "IMPROVING",
        },
      });
      await db.learnerMemoryEvidence.create({
        data: { memoryId: memory.id, userProfileId: owner, attemptId },
      });
      if (state !== "PENDING")
        await db.learnerMemory.update({
          where: { id: memory.id },
          data: { approvalState: state, reviewedAt: now },
        });
      if (content === "Approved observation") approvedId = memory.id;
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

  it("selects authorized confirmed evidence, approved memory, constraints and eligible candidates", async () => {
    const packet = await assembler.assemble(
      userId,
      { policy: { mode: "COACH", purpose: "PLANNING" }, messages: [] },
      now,
    );
    expect(packet.candidates.map((p) => p.id)).toEqual([freshId]);
    expect(packet.history.map((a) => a.id)).toEqual([historyId]);
    expect(packet.history[0]?.summary?.approach).toBe("Tracked visited nodes");
    expect(packet.history[0]?.assistance[0]?.type).toBe("DEBUGGING");
    expect(packet.memories.map((m) => m.id)).toEqual([approvedId]);
    expect(packet.memories[0]).toMatchObject({
      lifecycleState: "IMPROVING",
      lastObservedAt: "2026-07-01T00:00:00.000Z",
    });
    expect(packet.patterns[0]).toMatchObject({ stale: true, freshSamples: 1, assistedSamples: 1 });
    expect(packet.current.selections.map((s) => s.kind)).toEqual(["DIAGNOSTIC", "REDO"]);
    expect(packet.summary?.topics).toBe("Coach continuity");
    expect(JSON.stringify(packet)).not.toMatch(
      /FOREIGN_|PENDING_SECRET|REJECTED_SECRET|UNCONFIRMED_SECRET/,
    );
    expect(await db.dailyPlan.count()).toBe(0);
  });

  it("uses current attempt state and its own rolling summary, rejecting cross-tenant access", async () => {
    const packet = await assembler.assemble(
      userId,
      {
        policy: { mode: "ATTEMPT_TUTOR", attemptId: activeId, phase: "HELP", help: "DEBUGGING" },
        messages: [{ role: "user", content: "Transient code for this request" }],
      },
      now,
    );
    expect(packet.current.attempt?.id).toBe(activeId);
    expect(packet.summary?.topics).toBe("Tutor continuity");
    expect(packet.history[0]?.reason).toBe("RELATED_PATTERN");
    expect(packet.memories[0]?.reason).toBe("RELATED_PATTERN");
    expect(packet.messages[0]?.content).toBe("Transient code for this request");
    await expect(
      assembler.assemble(
        userId,
        { policy: { mode: "ATTEMPT_TUTOR", attemptId: foreignId, phase: "RESULT" }, messages: [] },
        now,
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(await db.assistanceEvent.count({ where: { attemptId: activeId } })).toBe(0);
  });

  it("records integrated help with ownership, sequential hints and solution-review provenance", async () => {
    const store = createPrismaTutorStore(db);
    const hint = { type: "CONCEPTUAL_HINT", hintLevel: 1 } as const;
    await expect(store.check(otherUserId, activeId, hint, now, true)).rejects.toMatchObject({
      statusCode: 404,
    });
    await db.attempt.update({ where: { id: activeId }, data: { timerSkippedAt: now } });
    await expect(
      store.check(userId, activeId, { type: "CONCEPTUAL_HINT", hintLevel: 2 }, now, true),
    ).rejects.toMatchObject({ statusCode: 409 });
    await store.check(userId, activeId, hint, now, false);
    expect(await db.assistanceEvent.count({ where: { attemptId: activeId } })).toBe(0);
    for (const hintLevel of [1, 2, 3])
      await store.check(userId, activeId, { type: "CONCEPTUAL_HINT", hintLevel }, now, true);
    await store.check(userId, activeId, { type: "DEBUGGING" }, now, true);
    const packet = await assembler.assemble(
      userId,
      {
        policy: {
          mode: "ATTEMPT_TUTOR",
          attemptId: activeId,
          phase: "HELP",
          help: "CONCEPTUAL_HINT",
          hintLevel: 3,
        },
        messages: [],
      },
      now,
    );
    expect(packet.current.attempt?.assistance).toHaveLength(4);
    expect(
      packet.current.attempt?.assistance.every((event) => event.source === "INTEGRATED_AI"),
    ).toBe(true);
    await expect(
      store.check(userId, activeId, { type: "SOLUTION_REVIEW" }, now, true),
    ).rejects.toMatchObject({ statusCode: 409 });
    await db.attempt.update({ where: { id: activeId }, data: { outcome: "GAVE_UP" } });
    await store.check(userId, activeId, { type: "SOLUTION_REVIEW" }, now, true);
    expect(await db.attempt.findUnique({ where: { id: activeId } })).toMatchObject({
      outcome: "GAVE_UP",
      solutionReviewedAt: now,
    });
    expect(
      await db.assistanceEvent.findMany({
        where: { attemptId: activeId, type: "SOLUTION_REVIEW" },
      }),
    ).toMatchObject([{ source: "INTEGRATED_AI", hintLevel: null }]);
    await db.attempt.update({ where: { id: activeId }, data: { confirmedAt: now } });
    await expect(
      store.check(userId, activeId, { type: "SOLUTION_REVIEW" }, now, true),
    ).rejects.toMatchObject({ statusCode: 409 });
    await db.attempt.update({ where: { id: activeId }, data: { confirmedAt: null } });
  });

  it("stops including a revoked memory on the next request", async () => {
    await db.learnerMemory.update({
      where: { id: approvedId },
      data: { approvalState: "REJECTED" },
    });
    const packet = await assembler.assemble(
      userId,
      { policy: { mode: "COACH", purpose: "GENERAL" }, messages: [] },
      now,
    );
    expect(packet.memories).toEqual([]);
  });
});
