import { afterEach, describe, expect, it, vi } from "vitest";

import { loadPracticeSettings, savePracticeSettings } from "./settingsApi";

const settings = {
  defaultAiModel: "gpt-5.4-mini" as const,
  reasoningEffort: null,
  attemptTimerMinutes: 30,
  allowPremiumProblems: true,
  difficultyPreference: "ANY" as const,
  dailyTarget: 2,
  redoIntervals: { high: 1, low: 7, medium: 3 },
  resetTime: "04:00",
  timeZone: "America/Toronto",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("settings API", () => {
  it("loads and validates practice settings", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ settings }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(loadPracticeSettings("https://api.example.com/", "access-token")).resolves.toEqual(
      settings,
    );
    expect(fetch).toHaveBeenCalledWith("https://api.example.com/settings", {
      headers: { authorization: "Bearer access-token" },
    });
  });

  it("saves settings with the active access token", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ settings }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(
      savePracticeSettings("https://api.example.com", "access-token", settings),
    ).resolves.toEqual(settings);
    expect(fetch).toHaveBeenCalledWith("https://api.example.com/settings", {
      body: JSON.stringify(settings),
      headers: {
        authorization: "Bearer access-token",
        "content-type": "application/json",
      },
      method: "PUT",
    });
  });

  it("rejects an invalid API response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ settings: { dailyTarget: 20 } }))),
    );

    await expect(loadPracticeSettings("https://api.example.com", "access-token")).rejects.toThrow(
      "The API returned invalid practice settings.",
    );
  });
});
