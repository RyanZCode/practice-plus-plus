import { describe, expect, it, vi } from "vitest";
import { loadRecentPractice, previousPracticeDates } from "./practiceHistory";

describe("recent practice dates", () => {
  it("uses the previous seven practice dates across month, year, and leap-day boundaries", () => {
    expect(previousPracticeDates("2026-01-03")).toEqual([
      "2025-12-27",
      "2025-12-28",
      "2025-12-29",
      "2025-12-30",
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
    ]);
    expect(previousPracticeDates("2024-03-01").at(-1)).toBe("2024-02-29");
    expect(previousPracticeDates("2026-03-09")).toHaveLength(7);
  });

  it("loads both required months and preserves historical counts and neutral days", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      const previous = new URL(String(url)).searchParams.has("month");
      const start = previous ? "2026-09-26" : "2026-10-01";
      const days = Array.from({ length: previous ? 5 : 3 }, (_, index) => {
        const date = new Date(`${start}T00:00:00Z`);
        date.setUTCDate(date.getUTCDate() + index);
        return {
          date: date.toISOString().slice(0, 10),
          status: index === 0 ? "NEUTRAL" : "COMPLETED",
          isCurrent: false,
          requiredCount: index === 0 ? 0 : 3,
          completedCount: index === 0 ? 0 : 3,
          neutralReason: index === 0 ? "NO_PRACTICE_AVAILABLE" : null,
        };
      });
      return Response.json({
        asOfPracticeDate: "2026-10-03",
        currentStreak: 4,
        trackingStartDate: "2026-09-26",
        month: previous ? "2026-09" : "2026-10",
        days,
      });
    });
    const history = await loadRecentPractice("https://api.example.com", "session-token", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]![0]).toBe(
      "https://api.example.com/analytics/streak?month=2026-09",
    );
    expect(fetcher.mock.calls[0]![1]?.headers).toEqual({ authorization: "Bearer session-token" });
    expect(history.currentStreak).toBe(4);
    expect(history.days).toHaveLength(7);
    expect(history.days[0]).toMatchObject({
      date: "2026-09-26",
      status: "NEUTRAL",
      completedCount: 0,
      requiredCount: 0,
    });
    expect(history.days.at(-1)).toMatchObject({
      date: "2026-10-02",
      completedCount: 3,
      requiredCount: 3,
    });
  });

  it("does not request another month when the seven dates fit in the current month", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        asOfPracticeDate: "2026-10-13",
        currentStreak: 0,
        trackingStartDate: null,
        month: "2026-10",
        days: previousPracticeDates("2026-10-13").map((date) => ({
          date,
          status: "UNTRACKED",
          isCurrent: false,
          completedCount: null,
          requiredCount: null,
          neutralReason: null,
        })),
      }),
    );
    const history = await loadRecentPractice("https://api.example.com", "token", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(history.days.every((day) => day.requiredCount === null)).toBe(true);
  });
});
