import { describe, expect, it } from "vitest";

import { practiceSettingsSchema } from "./index.js";

const validSettings = {
  defaultAiModel: "gpt-5.4-mini",
  reasoningEffort: null,
  attemptTimerMinutes: 30,
  dailyTarget: 2,
  redoIntervals: { high: 1, low: 7, medium: 3 },
  resetTime: "04:00",
  timeZone: "America/Toronto",
};

describe("practice settings contract", () => {
  it("accepts valid settings", () => {
    expect(practiceSettingsSchema.parse(validSettings)).toEqual(validSettings);
  });

  it.each([
    { ...validSettings, dailyTarget: 0 },
    { ...validSettings, attemptTimerMinutes: 0 },
    { ...validSettings, attemptTimerMinutes: 181 },
    { ...validSettings, dailyTarget: 2.5 },
    { ...validSettings, dailyTarget: 11 },
    { ...validSettings, defaultAiModel: "model with spaces" },
    { ...validSettings, reasoningEffort: "invalid" },
    { ...validSettings, resetTime: "24:00" },
    { ...validSettings, timeZone: "Toronto" },
    { ...validSettings, redoIntervals: { high: 0, low: 7, medium: 3 } },
    { ...validSettings, redoIntervals: { high: 4, low: 7, medium: 3 } },
    { ...validSettings, redoIntervals: { high: 1, low: 2, medium: 3 } },
  ])("rejects invalid settings", (settings) => {
    expect(practiceSettingsSchema.safeParse(settings).success).toBe(false);
  });
});
