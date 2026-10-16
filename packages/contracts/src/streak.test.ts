import { describe, expect, it } from "vitest";

import { streakCalendarQuerySchema, streakCalendarResponseSchema } from "./index.js";

const response = {
  asOfPracticeDate: "2026-09-17",
  currentStreak: 2,
  trackingStartDate: "2026-09-12",
  month: "2026-09",
  days: [
    {
      date: "2026-09-17",
      status: "CURRENT",
      isCurrent: true,
      requiredCount: 2,
      completedCount: 1,
      neutralReason: null,
    },
  ],
};

describe("streak calendar contracts", () => {
  it("accepts completed 4/3 and partial 2/3 counts", () => {
    for (const [status, completedCount] of [
      ["COMPLETED", 4],
      ["PARTIAL", 2],
    ] as const) {
      const calendar = {
        ...response,
        days: [{ ...response.days[0], status, completedCount, requiredCount: 3 }],
      };
      expect(streakCalendarResponseSchema.parse(calendar)).toEqual(calendar);
    }
  });
  it("accepts a month query and a calendar response", () => {
    expect(streakCalendarQuerySchema.parse({ month: "2026-09" })).toEqual({ month: "2026-09" });
    expect(streakCalendarResponseSchema.parse(response)).toEqual(response);
  });

  it.each([{ month: "2026-13" }, { month: "September" }, { month: ["2026-09"] }])(
    "rejects an invalid month query: $month",
    (query) => {
      expect(streakCalendarQuerySchema.safeParse(query).success).toBe(false);
    },
  );
  it("allows completion above the target while bounding the configured target", () => {
    const calendar = {
      ...response,
      days: [{ ...response.days[0], requiredCount: 20, completedCount: 21 }],
    };
    expect(streakCalendarResponseSchema.safeParse(calendar).success).toBe(true);
    expect(
      streakCalendarResponseSchema.safeParse({
        ...calendar,
        days: [{ ...calendar.days[0], requiredCount: 21 }],
      }).success,
    ).toBe(false);
  });
});
