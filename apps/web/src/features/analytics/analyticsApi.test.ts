import { describe, expect, it, vi } from "vitest";
import { loadAnalytics, loadStreakCalendar } from "./analyticsApi";

const response = {
  asOfPracticeDate: "2026-09-17",
  summary: {
    freshOutcomes: { independent: 2, assisted: 1, gaveUp: 0 },
    redo: {
      outcomes: { independent: 1, assisted: 0, gaveUp: 0, incomplete: 0 },
      successRate: 1,
    },
    assistance: {
      clarification: 0,
      conceptualHint: 1,
      debugging: 0,
      optimization: 0,
      solutionReview: 0,
    },
    optimality: { optimal: 2, suboptimal: 0, unknownOrOmitted: 1 },
    reviewWork: {
      overdueExactRedos: 1,
      overdueTransfers: 0,
      dueTodayExactRedos: 0,
      dueTodayTransfers: 1,
      overdueItems: [
        {
          type: "EXACT_REDO",
          sourceAttemptId: "30000000-0000-4000-8000-000000000001",
          dueDate: "2026-09-16",
          daysOverdue: 1,
          problem: {
            leetcodeId: 1,
            title: "Two Sum",
            url: "https://leetcode.com/problems/two-sum/",
          },
        },
      ],
    },
  },
  patterns: [],
};

const streakResponse = {
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

describe("analytics client", () => {
  it("loads and validates user analytics without caching", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));
    await expect(loadAnalytics("https://api.example.com/", "token", fetcher)).resolves.toEqual(
      response,
    );
    expect(fetcher).toHaveBeenCalledWith("https://api.example.com/analytics/patterns", {
      cache: "no-store",
      headers: { authorization: "Bearer token" },
    });
  });

  it("rejects an invalid response", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ ...response, summary: {} }), { status: 200 }),
      );
    await expect(loadAnalytics("https://api.example.com", "token", fetcher)).rejects.toThrow();
  });

  it("loads a requested streak month without caching", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(streakResponse), { status: 200 }));

    await expect(
      loadStreakCalendar("https://api.example.com/", "token", "2026-09", fetcher),
    ).resolves.toEqual(streakResponse);
    expect(fetcher).toHaveBeenCalledWith("https://api.example.com/analytics/streak?month=2026-09", {
      cache: "no-store",
      headers: { authorization: "Bearer token" },
    });
  });

  it("rejects an invalid streak response", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ ...streakResponse, month: "bad" }), { status: 200 }),
      );

    await expect(
      loadStreakCalendar("https://api.example.com", "token", undefined, fetcher),
    ).rejects.toThrow();
  });
});
