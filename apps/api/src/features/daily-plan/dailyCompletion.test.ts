import { describe, expect, it, vi } from "vitest";

import type { Prisma } from "../../shared/generated/prisma/client.js";
import { ensureDailyCompletion, updateDailyCompletionForAttempt } from "./dailyCompletion.js";

const userProfileId = "25d64b95-b7cc-4fe5-91ac-ae296dc66383";

function database() {
  const tx = {
    dailyCompletion: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    dailyPlanItem: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  return { tx: tx as unknown as Prisma.TransactionClient };
}

describe("daily completion lifecycle", () => {
  it("captures the achievable item count and neutralizes an empty plan", async () => {
    const { tx } = database();

    await ensureDailyCompletion(tx, userProfileId, null, {
      practiceDate: new Date("2026-09-17T00:00:00.000Z"),
      target: 5,
      timeZone: "UTC",
      resetMinutes: 0,
      itemCount: 0,
    });

    expect(tx.dailyCompletion.create).toHaveBeenCalledWith({
      data: {
        userProfileId,
        practiceDate: new Date("2026-09-17T00:00:00.000Z"),
        requiredCount: 0,
        completedCount: 0,
        state: "NEUTRAL",
        neutralReason: "NO_PRACTICE_AVAILABLE",
      },
    });
  });

  it("records only boundary-skipped dates after tracking has started", async () => {
    const { tx } = database();
    vi.mocked(tx.dailyCompletion.findFirst).mockResolvedValue({
      practiceDate: new Date("2026-09-10T00:00:00.000Z"),
    } as never);

    await ensureDailyCompletion(
      tx,
      userProfileId,
      {
        practiceDate: new Date("2026-09-10T00:00:00.000Z"),
        timeZone: "UTC",
        resetMinutes: 0,
      },
      {
        practiceDate: new Date("2026-09-13T00:00:00.000Z"),
        target: 2,
        timeZone: "America/Toronto",
        resetMinutes: 240,
        itemCount: 1,
      },
    );

    expect(tx.dailyCompletion.createMany).toHaveBeenCalledWith({
      data: [
        {
          userProfileId,
          practiceDate: new Date("2026-09-11T00:00:00.000Z"),
          requiredCount: 0,
          completedCount: 0,
          state: "NEUTRAL",
          neutralReason: "BOUNDARY_CHANGE",
        },
        {
          userProfileId,
          practiceDate: new Date("2026-09-12T00:00:00.000Z"),
          requiredCount: 0,
          completedCount: 0,
          state: "NEUTRAL",
          neutralReason: "BOUNDARY_CHANGE",
        },
      ],
      skipDuplicates: true,
    });
    expect(tx.dailyCompletion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ requiredCount: 1, state: "ACTIVE" }),
      }),
    );
  });

  it("does not recreate a completion record for an already recorded date", async () => {
    const { tx } = database();
    vi.mocked(tx.dailyCompletion.findUnique).mockResolvedValue({
      practiceDate: new Date(),
    } as never);

    await ensureDailyCompletion(tx, userProfileId, null, {
      practiceDate: new Date("2026-09-17T00:00:00.000Z"),
      target: 2,
      timeZone: "UTC",
      resetMinutes: 0,
      itemCount: 2,
    });

    expect(tx.dailyCompletion.findFirst).not.toHaveBeenCalled();
    expect(tx.dailyCompletion.create).not.toHaveBeenCalled();
  });

  it("fulfills the day only for a confirmed plan-linked qualifying outcome", async () => {
    const { tx } = database();
    vi.mocked(tx.dailyPlanItem.findFirst).mockResolvedValue({
      plan: { practiceDate: new Date("2026-09-17T00:00:00.000Z") },
    } as never);
    vi.mocked(tx.dailyCompletion.findUnique).mockResolvedValue({
      state: "ACTIVE",
      requiredCount: 1,
      completedCount: 0,
    } as never);
    const confirmedAt = new Date("2026-09-17T13:00:00.000Z");

    await updateDailyCompletionForAttempt(
      tx,
      userProfileId,
      "d3b65a55-1a50-43e1-82e0-e23a263925a5",
      "ASSISTED",
      confirmedAt,
    );

    expect(tx.dailyCompletion.update).toHaveBeenCalledWith({
      where: {
        userProfileId_practiceDate: {
          userProfileId,
          practiceDate: new Date("2026-09-17T00:00:00.000Z"),
        },
      },
      data: { completedCount: 1, state: "FULFILLED", fulfilledAt: confirmedAt },
    });
  });

  it.each(["INCOMPLETE", "INDEPENDENT"])(
    "does not count an unlinked or non-qualifying outcome: %s",
    async (outcome) => {
      const { tx } = database();
      if (outcome === "INDEPENDENT")
        vi.mocked(tx.dailyPlanItem.findFirst).mockResolvedValue({
          plan: { practiceDate: new Date("2026-09-17T00:00:00.000Z") },
        } as never);

      await updateDailyCompletionForAttempt(
        tx,
        userProfileId,
        "d3b65a55-1a50-43e1-82e0-e23a263925a5",
        outcome,
        new Date(),
      );

      if (outcome === "INCOMPLETE") {
        expect(tx.dailyPlanItem.findFirst).not.toHaveBeenCalled();
      } else {
        expect(tx.dailyCompletion.update).not.toHaveBeenCalled();
      }
    },
  );
});
