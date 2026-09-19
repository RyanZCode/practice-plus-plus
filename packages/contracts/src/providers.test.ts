import { describe, expect, it } from "vitest";

import {
  practiceSettingsSchema,
  providerModelDiscoveryRequestSchema,
  providerModelDiscoveryResponseSchema,
  providerSelectionSchema,
} from "./index.js";

describe("provider selection", () => {
  it("accepts a configurable model and trims surrounding whitespace", () => {
    expect(
      providerSelectionSchema.parse({ providerId: "openai", model: " custom-model:v2 " }),
    ).toEqual({ providerId: "openai", model: "custom-model:v2" });
  });

  it.each([
    { providerId: "https://api.openai.com", model: "model" },
    { providerId: "other", model: "model" },
    { providerId: "__proto__", model: "model" },
    { providerId: "openai", model: "model", baseUrl: "https://example.com" },
    { providerId: "openai", model: "model", headers: { authorization: "secret" } },
    { providerId: "openai", model: "" },
    { providerId: "openai", model: "a".repeat(201) },
    { providerId: "openai", model: "model\r\ninjected" },
    { providerId: "openai", model: "model", reasoningEffort: "invalid" },
  ])("rejects invalid selections and extra configuration: %j", (selection) => {
    expect(providerSelectionSchema.safeParse(selection).success).toBe(false);
  });
});

describe("provider model discovery", () => {
  it("accepts account-specific model IDs in settings and discovery responses", () => {
    expect(
      practiceSettingsSchema.parse({
        defaultAiModel: "enterprise-chat:v2",
        reasoningEffort: null,
        attemptTimerMinutes: 30,
        allowPremiumProblems: true,
        difficultyPreference: "ANY",
        dailyTarget: 2,
        redoIntervals: { high: 1, low: 7, medium: 3 },
        resetTime: "04:00",
        timeZone: "UTC",
      }).defaultAiModel,
    ).toBe("enterprise-chat:v2");
    expect(
      providerModelDiscoveryResponseSchema.parse({
        providerId: "openai",
        state: "READY",
        models: [{ id: "gpt-4.1", reasoningEfforts: [] }],
      }),
    ).toEqual({
      providerId: "openai",
      state: "READY",
      models: [{ id: "gpt-4.1", reasoningEfforts: [] }],
    });
  });

  it("keeps discovery credentials and provider selection strict", () => {
    expect(
      providerModelDiscoveryRequestSchema.safeParse({
        providerId: "openai",
        apiKey: "private-key",
        destination: "https://example.com",
      }).success,
    ).toBe(false);
    expect(
      providerModelDiscoveryRequestSchema.safeParse({
        providerId: "constructor",
        apiKey: "private-key",
      }).success,
    ).toBe(false);
  });
});
