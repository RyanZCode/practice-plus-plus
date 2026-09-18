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
});
