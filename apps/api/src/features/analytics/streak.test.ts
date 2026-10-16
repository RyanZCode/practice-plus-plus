import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../../shared/generated/prisma/client.js";
import { buildStreakCalendar, createPrismaStreakStore } from "./streak.js";

const userProfileId = "25d64b95-b7cc-4fe5-91ac-ae296dc66383";

function record(
  practiceDate: string,
  state: "ACTIVE" | "FULFILLED" | "NEUTRAL",
  overrides: Record<string, unknown> = {},
) {
  return {
    practiceDate,
    requiredCount: state === "NEUTRAL" ? 0 : 2,
    completedCount: state === "FULFILLED" ? 2 : 0,
    state,
    neutralReason: state === "NEUTRAL" ? "NO_PRACTICE_AVAILABLE" : null,
    ...overrides,
  } as const;
}

describe("streak calendar derivation", () => {
  it("keeps over-target counts and lets the current partial day finish without breaking yesterday's streak", () => {
    const records = [
      { practiceDate: "2026-09-10", requiredCount: 3, completedCount: 4 },
      { practiceDate: "2026-09-11", requiredCount: 3, completedCount: 3 },
      { practiceDate: "2026-09-12", requiredCount: 3, completedCount: 1 },
    ];
    const calendar = buildStreakCalendar(records, "2026-09-12", undefined, 3);
    expect(calendar.currentStreak).toBe(2);
    expect(calendar.days.find((day) => day.date === "2026-09-10")).toMatchObject({
      status: "COMPLETED",
      completedCount: 4,
      requiredCount: 3,
    });
    expect(calendar.days.find((day) => day.date === "2026-09-12")).toMatchObject({
      status: "PARTIAL",
      isCurrent: true,
      completedCount: 1,
      requiredCount: 3,
    });
    expect(buildStreakCalendar(records, "2026-09-13", undefined, 3).currentStreak).toBe(0);
  });

  it("shows 0/target on days without a generated plan and keeps later targets from rewriting a missed day", () => {
    const calendar = buildStreakCalendar(
      [
        { practiceDate: "2026-09-10", requiredCount: 3, completedCount: 3 },
        { practiceDate: "2026-09-14", requiredCount: 5, completedCount: 5 },
      ],
      "2026-09-15",
      undefined,
      7,
    );
    expect(calendar.days.find((day) => day.date === "2026-09-13")).toMatchObject({
      status: "MISSED",
      completedCount: 0,
      requiredCount: 3,
    });
    expect(calendar.days.find((day) => day.date === "2026-09-15")).toMatchObject({
      status: "CURRENT",
      completedCount: 0,
      requiredCount: 7,
    });
    expect(calendar.days.some((day) => day.status === "NEUTRAL")).toBe(false);
  });

  it("shows the target before the first plan is generated", () => {
    const calendar = buildStreakCalendar([], "2026-09-15", undefined, 3);
    expect(calendar.days.find((day) => day.date === "2026-09-15")).toMatchObject({
      status: "CURRENT",
      completedCount: 0,
      requiredCount: 3,
    });
  });
  it("distinguishes partial days and treats legacy neutral dates as missed", () => {
    const calendar = buildStreakCalendar(
      [
        record("2026-09-10", "FULFILLED"),
        record("2026-09-11", "NEUTRAL"),
        record("2026-09-12", "ACTIVE", { completedCount: 1 }),
        record("2026-09-14", "FULFILLED"),
      ],
      "2026-09-14",
      "2026-09",
    );

    expect(calendar.currentStreak).toBe(1);
    expect(calendar.trackingStartDate).toBe("2026-09-10");
    expect(calendar.days.find((day) => day.date === "2026-09-01")?.status).toBe("UNTRACKED");
    expect(calendar.days.find((day) => day.date === "2026-09-10")?.status).toBe("COMPLETED");
    expect(calendar.days.find((day) => day.date === "2026-09-11")?.status).toBe("MISSED");
    expect(calendar.days.find((day) => day.date === "2026-09-12")?.status).toBe("PARTIAL");
    expect(calendar.days.find((day) => day.date === "2026-09-13")).toMatchObject({
      status: "MISSED",
      requiredCount: 2,
      completedCount: 0,
    });
    expect(calendar.days.find((day) => day.date === "2026-09-14")?.status).toBe("COMPLETED");
    expect(calendar.days.find((day) => day.date === "2026-09-15")?.status).toBe("FUTURE");
  });

  it("does not break the streak for the current day but counts legacy zero days as missed", () => {
    const calendar = buildStreakCalendar(
      [record("2026-09-12", "FULFILLED"), record("2026-09-13", "NEUTRAL")],
      "2026-09-14",
      "2026-09",
    );

    expect(calendar.currentStreak).toBe(0);
    expect(calendar.days.find((day) => day.date === "2026-09-14")).toMatchObject({
      status: "CURRENT",
      isCurrent: true,
    });
  });

  it("keeps dates before tracking unmarked and reports no streak without history", () => {
    const calendar = buildStreakCalendar([], "2026-09-14", "2026-09");

    expect(calendar.currentStreak).toBe(0);
    expect(calendar.trackingStartDate).toBeNull();
    expect(calendar.days.find((day) => day.date === "2026-09-13")?.status).toBe("UNTRACKED");
    expect(calendar.days.find((day) => day.date === "2026-09-14")?.status).toBe("CURRENT");
  });
});

it("loads only the authenticated user's completion history using the practice-day boundary", async () => {
  const findUnique = vi
    .fn()
    .mockResolvedValue({ timeZone: "America/Toronto", resetMinutes: 240, dailyTarget: 2 });
  const findMany = vi.fn().mockResolvedValue([]);
  const client = {
    practiceSettings: { findUnique },
    dailyPlan: { findUnique: vi.fn().mockResolvedValue(null) },
    dailyCompletion: { findMany },
    attempt: { groupBy: vi.fn().mockResolvedValue([]) },
  } as unknown as PrismaClient;

  const result = await createPrismaStreakStore(client).calendar(
    userProfileId,
    new Date("2026-09-17T12:00:00.000Z"),
  );

  expect(result.asOfPracticeDate).toBe("2026-09-17");
  expect(findUnique).toHaveBeenCalledWith({
    where: { userProfileId },
    select: { timeZone: true, resetMinutes: true, dailyTarget: true },
  });
  expect(findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        userProfileId,
        practiceDate: { lte: new Date("2026-09-17T00:00:00.000Z") },
      },
    }),
  );
  expect(client.attempt.groupBy).toHaveBeenCalledWith(
    expect.objectContaining({
      by: ["practiceDate", "outcome"],
      where: {
        userProfileId,
        practiceDate: { lte: new Date("2026-09-17T00:00:00Z") },
        confirmedAt: { not: null },
        outcome: { in: ["INDEPENDENT", "ASSISTED", "GAVE_UP", "INCOMPLETE"] },
      },
      _count: { _all: true },
    }),
  );
});

it("keeps the saved plan boundary current after a settings change", async () => {
  const findMany = vi.fn().mockResolvedValue([]);
  const client = {
    practiceSettings: {
      findUnique: vi.fn().mockResolvedValue({ timeZone: "UTC", resetMinutes: 0, dailyTarget: 2 }),
    },
    dailyPlan: {
      findUnique: vi.fn().mockResolvedValue({
        practiceDate: new Date("2026-09-16T00:00:00.000Z"),
        timeZone: "America/Toronto",
        resetMinutes: 240,
        target: 2,
      }),
    },
    dailyCompletion: { findMany },
    attempt: { groupBy: vi.fn().mockResolvedValue([]) },
  } as unknown as PrismaClient;

  const result = await createPrismaStreakStore(client).calendar(
    userProfileId,
    new Date("2026-09-17T06:00:00.000Z"),
  );

  expect(result.asOfPracticeDate).toBe("2026-09-16");
  expect(findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        userProfileId,
        practiceDate: { lte: new Date("2026-09-16T00:00:00.000Z") },
      },
    }),
  );
});
