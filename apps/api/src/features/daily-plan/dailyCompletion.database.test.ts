import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../../shared/generated/prisma/client.js";
import { createPrismaStreakStore } from "../analytics/streak.js";
import { createPrismaAttemptStore } from "../attempts/attempts.js";
import { ensureDailyCompletion, updateDailyCompletionForAttempt } from "./dailyCompletion.js";

const databaseUrl = process.env.LEARNER_CONTEXT_TEST_DATABASE_URL;
const schema = `completion_test_${randomUUID().replaceAll("-", "")}`;
const userId = randomUUID();
const otherUserId = randomUUID();
const practiceDate = new Date("2026-09-17T00:00:00Z");
const confirmedAt = new Date("2026-09-17T14:00:00Z");

describe.skipIf(databaseUrl === undefined)("daily completion database", () => {
  const sql = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }, { schema }),
  });
  let checkpointAttemptId: string;

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
    for (const id of [userId, otherUserId]) {
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
    }
    const pattern = await db.pattern.findUniqueOrThrow({ where: { name: "Dynamic Programming" } });
    const problem = await db.problem.create({
      data: {
        leetcodeId: 198,
        slug: "house-robber",
        title: "House Robber",
        difficulty: "MEDIUM",
        url: "https://leetcode.com/problems/house-robber/",
        published: true,
        reviewStatus: "APPROVED",
        problemPatterns: { create: { patternId: pattern.id } },
      },
    });
    for (const owner of [userId, otherUserId]) {
      for (const [index, outcome] of (
        ["INDEPENDENT", "ASSISTED", "GAVE_UP", "INDEPENDENT", "INCOMPLETE"] as const
      ).entries()) {
        const attempt = await db.attempt.create({
          data: {
            userProfileId: owner,
            problemId: problem.id,
            type: index === 0 ? "FRESH" : "REDO",
            practiceDate,
            startedAt: new Date("2026-09-17T13:00:00Z"),
            timerEndsAt: new Date("2026-09-17T13:30:00Z"),
            confirmedAt,
            outcome,
            ...(index === 0
              ? {
                  summary: {
                    create: {
                      approach: "Tracked the previous two totals.",
                      finalUnderstanding: "Compared taking and skipping each house.",
                      reviewedAt: confirmedAt,
                    },
                  },
                }
              : {}),
          },
        });
        if (owner === userId && index === 0) checkpointAttemptId = attempt.id;
      }
    }
    await db.attempt.create({
      data: {
        userProfileId: userId,
        problemId: problem.id,
        type: "REDO",
        practiceDate,
        startedAt: new Date("2026-09-17T15:00:00Z"),
        timerEndsAt: new Date("2026-09-17T15:30:00Z"),
      },
    });
    await db.$transaction((tx) => ensureDailyCompletion(tx, userId, { practiceDate, target: 3 }));
  });

  afterAll(async () => {
    await db.$disconnect();
    await sql.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await sql.end();
  });

  it("persists 4/3 without a plan link and does not count another user's, incomplete, or unconfirmed work", async () => {
    for (let retry = 0; retry < 2; retry++) {
      await db.$transaction((tx) =>
        updateDailyCompletionForAttempt(tx, userId, practiceDate, confirmedAt),
      );
    }
    expect(
      await db.dailyCompletion.findUniqueOrThrow({
        where: { userProfileId_practiceDate: { userProfileId: userId, practiceDate } },
      }),
    ).toMatchObject({
      requiredCount: 3,
      completedCount: 4,
      state: "FULFILLED",
      fulfilledAt: confirmedAt,
    });
    const calendar = await createPrismaStreakStore(db).calendar(userId, confirmedAt);
    expect(calendar.days.find((day) => day.date === "2026-09-17")).toMatchObject({
      status: "COMPLETED",
      requiredCount: 3,
      completedCount: 4,
    });
  });

  it("shows legacy no-practice dates and missing-plan dates as 0/target", async () => {
    await db.dailyCompletion.create({
      data: {
        userProfileId: userId,
        practiceDate: new Date("2026-09-18"),
        requiredCount: 0,
        completedCount: 0,
        state: "NEUTRAL",
        neutralReason: "NO_PRACTICE_AVAILABLE",
      },
    });
    const calendar = await createPrismaStreakStore(db).calendar(
      userId,
      new Date("2026-09-20T12:00:00Z"),
    );
    for (const date of ["2026-09-18", "2026-09-19"]) {
      expect(calendar.days.find((day) => day.date === date)).toMatchObject({
        status: "MISSED",
        requiredCount: 3,
        completedCount: 0,
      });
    }
    expect(calendar.days.find((day) => day.isCurrent)).toMatchObject({
      requiredCount: 3,
      completedCount: 0,
    });
    expect(calendar.days.some((day) => day.status === "NEUTRAL")).toBe(false);
  });

  it("loads complete History details while retaining pattern visibility and owner isolation", async () => {
    const history = await createPrismaAttemptStore(db).history(userId, { page: 1 });
    expect(history.attempts).toHaveLength(5);
    expect(history.attempts.find((attempt) => attempt.id === checkpointAttemptId)).toMatchObject({
      patterns: ["Dynamic Programming"],
      summary: {
        approach: "Tracked the previous two totals.",
        finalUnderstanding: "Compared taking and skipping each house.",
        reviewedAt: confirmedAt.toISOString(),
      },
    });
    expect(
      history.attempts.find((attempt) => attempt.outcome === "INCOMPLETE")?.patterns,
    ).toBeUndefined();
  });
});
