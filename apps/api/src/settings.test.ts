import { describe, expect, it, vi } from "vitest";

import { createPrismaSettingsStore } from "./settings.js";

const settings = {
  dailyTarget: 2,
  redoIntervals: { high: 1, low: 7, medium: 3 },
  resetTime: "04:30",
  timeZone: "America/Toronto",
};

const settingsRecord = {
  dailyTarget: 2,
  highIntervalDays: 1,
  lowIntervalDays: 7,
  mediumIntervalDays: 3,
  resetMinutes: 270,
  timeZone: "America/Toronto",
};

describe("Prisma settings store", () => {
  it("loads settings by application profile", async () => {
    const findUnique = vi.fn().mockResolvedValue(settingsRecord);
    const store = createPrismaSettingsStore({
      practiceSettings: { findUnique, upsert: vi.fn() },
    });

    await expect(store.findByUserProfileId("profile-id")).resolves.toEqual(settings);
    expect(findUnique).toHaveBeenCalledWith({ where: { userProfileId: "profile-id" } });
  });

  it("reports incomplete onboarding when no settings exist", async () => {
    const store = createPrismaSettingsStore({
      practiceSettings: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
    });

    await expect(store.findByUserProfileId("profile-id")).resolves.toBeNull();
  });

  it("upserts settings for the authenticated application profile", async () => {
    const upsert = vi.fn().mockResolvedValue(settingsRecord);
    const store = createPrismaSettingsStore({
      practiceSettings: { findUnique: vi.fn(), upsert },
    });

    await expect(store.save("profile-id", settings)).resolves.toEqual(settings);
    expect(upsert).toHaveBeenCalledWith({
      create: { ...settingsRecord, userProfileId: "profile-id" },
      update: settingsRecord,
      where: { userProfileId: "profile-id" },
    });
  });
});
