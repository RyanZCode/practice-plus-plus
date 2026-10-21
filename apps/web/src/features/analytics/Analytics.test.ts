import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnalyticsView, StreakCalendarView } from "./Analytics";

it("renders decision-oriented analytics with definitions and no skill-score claim", () => {
  const html = renderToStaticMarkup(
    createElement(AnalyticsView, {
      analytics: {
        asOfPracticeDate: "2026-09-17",
        summary: {
          freshOutcomes: { independent: 4, assisted: 2, gaveUp: 1 },
          redo: {
            outcomes: { independent: 2, assisted: 1, gaveUp: 1, incomplete: 1 },
            successRate: 0.75,
          },
          assistance: {
            clarification: 1,
            conceptualHint: 2,
            debugging: 3,
            optimization: 1,
            solutionReview: 1,
          },
          optimality: { optimal: 4, suboptimal: 2, unknownOrOmitted: 1 },
          reviewWork: {
            overdueExactRedos: 2,
            overdueTransfers: 1,
            dueTodayExactRedos: 1,
            dueTodayTransfers: 0,
            overdueItems: [
              {
                type: "EXACT_REDO",
                sourceAttemptId: "30000000-0000-4000-8000-000000000001",
                dueDate: "2026-09-15",
                daysOverdue: 2,
                problem: {
                  leetcodeId: 1,
                  title: "Two Sum",
                  url: "https://leetcode.com/problems/two-sum/",
                },
              },
              {
                type: "TRANSFER",
                transferId: "40000000-0000-4000-8000-000000000001",
                sourceAttemptId: "30000000-0000-4000-8000-000000000002",
                dueDate: "2026-09-14",
                daysOverdue: 3,
                patternName: "Graphs",
                sourceProblemTitle: "Number of Islands",
              },
            ],
          },
        },
        patterns: [
          {
            patternId: "10000000-0000-4000-8000-000000000001",
            patternName: "Graphs",
            problems: [],
            classification: "NEEDS_PRACTICE",
            fresh: {
              sampleCount: 5,
              weightedTotal: 5,
              weightedWeakSignals: 3,
              outcomes: { independent: 2, assisted: 2, gaveUp: 1 },
            },
            redo: {
              outcomes: { independent: 1, assisted: 0, gaveUp: 1, incomplete: 0 },
              successRate: 0.5,
            },
            assistance: {
              clarification: 0,
              conceptualHint: 2,
              debugging: 1,
              optimization: 0,
              solutionReview: 1,
            },
            highestConceptualHintLevel: 2,
            optimality: { optimal: 2, suboptimal: 2, unknownOrOmitted: 1 },
            lastPracticed: "2026-09-16",
            stale: false,
            recentExposureShare: 0.6,
            overconcentrated: true,
          },
        ],
      },
    }),
  );

  expect(html).toContain("Progress");
  expect(html).toContain("3 overdue</strong>");
  expect(html).toContain("75% · 3 / 4 solved");
  expect(html).toContain("5 / 10 fresh samples");
  expect(html).toContain("5.0 total · 3.0 needs practice");
  expect(html).toContain("Samples and weights");
  expect(html).toContain("Graphs");
  expect(html).toContain("Needs practice");
  expect(html).toContain("Metric definitions");
  expect(html).toContain("It is not a mastery score");
  expect(html).toContain("Two Sum");
  expect(html).toContain("Graphs transfer");
  expect(html).toContain("No destination is selected until this transfer is scheduled");
  expect(html).not.toContain("leaderboard");
  expect(html).not.toContain("streak");
});

describe("analytics empty states", () => {
  it("keeps missing denominators explicit", () => {
    const html = renderToStaticMarkup(
      createElement(AnalyticsView, {
        analytics: {
          asOfPracticeDate: "2026-09-17",
          summary: {
            freshOutcomes: { independent: 0, assisted: 0, gaveUp: 0 },
            redo: {
              outcomes: { independent: 0, assisted: 0, gaveUp: 0, incomplete: 0 },
              successRate: null,
            },
            assistance: {
              clarification: 0,
              conceptualHint: 0,
              debugging: 0,
              optimization: 0,
              solutionReview: 0,
            },
            optimality: { optimal: 0, suboptimal: 0, unknownOrOmitted: 0 },
            reviewWork: {
              overdueExactRedos: 0,
              overdueTransfers: 0,
              dueTodayExactRedos: 0,
              dueTodayTransfers: 0,
              overdueItems: [],
            },
          },
          patterns: [],
        },
      }),
    );
    expect(html).toContain("Not enough data");
    expect(html).toContain("No known ratings");
  });
});

it("renders partial, missed, and extra counts without neutral or future legend entries", () => {
  const html = renderToStaticMarkup(
    createElement(StreakCalendarView, {
      calendar: {
        asOfPracticeDate: "2026-09-17",
        currentStreak: 2,
        trackingStartDate: "2026-09-12",
        month: "2026-09",
        days: [
          {
            date: "2026-09-17",
            status: "COMPLETED",
            isCurrent: true,
            requiredCount: 2,
            completedCount: 3,
            neutralReason: null,
          },
          {
            date: "2026-09-16",
            status: "COMPLETED",
            isCurrent: false,
            requiredCount: 2,
            completedCount: 2,
            neutralReason: null,
          },
          {
            date: "2026-09-13",
            status: "PARTIAL",
            isCurrent: false,
            requiredCount: 2,
            completedCount: 1,
            neutralReason: null,
          },
          {
            date: "2026-09-15",
            status: "MISSED",
            isCurrent: false,
            requiredCount: 2,
            completedCount: 0,
            neutralReason: null,
          },
          {
            date: "2026-09-14",
            status: "PARTIAL",
            isCurrent: false,
            requiredCount: 3,
            completedCount: 1,
            neutralReason: null,
          },
        ],
      },
      onPreviousMonth: () => undefined,
      onNextMonth: () => undefined,
    }),
  );

  expect(html).toContain("Consistency");
  expect(html).toContain("2 days</strong>");
  expect(html).toContain("Completed");
  expect(html).toContain("Partial");
  expect(html).toContain("1/3");
  expect(html).not.toContain("Neutral");
  expect(html).not.toContain("Future</li>");
  expect(html).toContain('aria-current="date"');
  expect(html).toContain("0/2");
  expect(html).toContain("Counts can exceed the target");
  expect(html).toContain("streak-day streak-day-completed streak-day-today");
  expect(html).toContain("3 of 2 completed.");
  expect(html).toContain("3/2");
  expect(html).not.toContain("Extra practice");
  expect(html).not.toContain("motivational context");
});
