import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "../../shared/generated/prisma/client.js";
import { ensureDailyCompletion, updateDailyCompletionForAttempt } from "./dailyCompletion.js";

const userProfileId = "25d64b95-b7cc-4fe5-91ac-ae296dc66383";
const practiceDate = new Date("2026-09-17T00:00:00Z");
const confirmedAt = new Date("2026-09-17T13:00:00Z");
function database() {
  const mock = {
    dailyCompletion: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
    dailyPlan: { findUnique: vi.fn().mockResolvedValue(null) },
    practiceSettings: { findUniqueOrThrow: vi.fn().mockResolvedValue({ dailyTarget: 3 }) },
    attempt: { count: vi.fn().mockResolvedValue(1) },
  };
  return { mock, tx: mock as unknown as Prisma.TransactionClient };
}

describe("daily completion lifecycle", () => {
  it("captures the configured target even when a plan has no eligible work", async () => {
    const { tx, mock } = database();
    await ensureDailyCompletion(tx, userProfileId, { practiceDate, target: 3 });
    expect(mock.dailyCompletion.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: {
          userProfileId,
          practiceDate,
          requiredCount: 3,
          completedCount: 0,
          state: "ACTIVE",
        },
      }),
    );
  });
  it("preserves an existing day's captured target", async () => {
    const { tx, mock } = database();
    mock.dailyCompletion.findUnique.mockResolvedValue({ requiredCount: 3 });
    await ensureDailyCompletion(tx, userProfileId, { practiceDate, target: 5 });
    expect(mock.dailyCompletion.upsert).not.toHaveBeenCalled();
  });
  it("replaces a legacy zero quota when that day's plan is generated", async () => {
    const { tx, mock } = database();
    mock.dailyCompletion.findUnique.mockResolvedValue({ requiredCount: 0 });
    await ensureDailyCompletion(tx, userProfileId, { practiceDate, target: 3 });
    expect(mock.dailyCompletion.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { requiredCount: 3, state: "ACTIVE", neutralReason: null },
      }),
    );
  });
  it("counts qualifying confirmed work without requiring a plan link", async () => {
    const { tx, mock } = database();
    await updateDailyCompletionForAttempt(tx, userProfileId, practiceDate, confirmedAt);
    expect(mock.attempt.count).toHaveBeenCalledWith({
      where: {
        userProfileId,
        practiceDate,
        confirmedAt: { not: null },
        outcome: { in: ["INDEPENDENT", "ASSISTED", "GAVE_UP"] },
      },
    });
    expect(mock.dailyCompletion.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: {
          userProfileId,
          practiceDate,
          requiredCount: 3,
          completedCount: 1,
          state: "ACTIVE",
          fulfilledAt: null,
          neutralReason: null,
        },
      }),
    );
  });
  it("keeps counts above the target and the original fulfillment time", async () => {
    const { tx, mock } = database();
    const fulfilledAt = new Date("2026-09-17T12:00:00Z");
    mock.dailyCompletion.findUnique.mockResolvedValue({ requiredCount: 3, fulfilledAt });
    mock.attempt.count.mockResolvedValue(4);
    await updateDailyCompletionForAttempt(tx, userProfileId, practiceDate, confirmedAt);
    expect(mock.dailyCompletion.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {
          requiredCount: 3,
          completedCount: 4,
          state: "FULFILLED",
          fulfilledAt,
          neutralReason: null,
        },
      }),
    );
    expect(mock.practiceSettings.findUniqueOrThrow).not.toHaveBeenCalled();
  });
  it("uses the active plan's captured target instead of changed settings", async () => {
    const { tx, mock } = database();
    mock.dailyPlan.findUnique.mockResolvedValue({ practiceDate, target: 2 });
    mock.attempt.count.mockResolvedValue(2);
    await updateDailyCompletionForAttempt(tx, userProfileId, practiceDate, confirmedAt);
    expect(mock.dailyCompletion.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          requiredCount: 2,
          completedCount: 2,
          state: "FULFILLED",
          fulfilledAt: confirmedAt,
        }),
      }),
    );
    expect(mock.practiceSettings.findUniqueOrThrow).not.toHaveBeenCalled();
  });
  it("tracks a day with only incomplete attempts without counting them", async () => {
    const { tx, mock } = database();
    mock.attempt.count.mockResolvedValue(0);
    await updateDailyCompletionForAttempt(tx, userProfileId, practiceDate, confirmedAt);
    expect(mock.attempt.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ outcome: { in: ["INDEPENDENT", "ASSISTED", "GAVE_UP"] } }),
      }),
    );
    expect(mock.dailyCompletion.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ completedCount: 0, state: "ACTIVE" }),
      }),
    );
  });
});
