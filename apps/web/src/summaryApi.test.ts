import { describe, expect, it, vi } from "vitest";
import { checkpointMessages, needsCheckpoint, saveCheckpoint } from "./summaryApi";

const input = {
  selection: { providerId: "openai" as const, model: "test-model" },
  apiKey: "private-key",
  mode: "COACH" as const,
  attemptId: null,
  messages: [
    { role: "user" as const, content: "Reflect" },
    { role: "assistant" as const, content: "Slow down" },
  ],
};

describe("learning checkpoint client", () => {
  it("posts the active transcript only to the checkpoint request", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          summary: {
            id: "25d64b95-b7cc-4fe5-91ac-ae296dc66383",
            mode: "COACH",
            attemptId: null,
            topics: "Pacing",
            learningProgress: null,
            nextSteps: null,
            updatedAt: "2026-09-13T12:00:00.000Z",
          },
          attemptSummary: null,
          memorySuggestions: [],
        }),
        { status: 200 },
      ),
    );
    await saveCheckpoint("https://api.example.com/", "token", input, fetcher);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.example.com/ai/checkpoints");
    const options = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(options.cache).toBe("no-store");
    expect(JSON.parse(String(options.body))).toEqual(input);
  });

  it("removes UI-only message metadata before checkpoint validation", () => {
    expect(
      checkpointMessages([
        { role: "user", content: "Reflect", complete: true },
        { role: "assistant", content: "Slow down", label: "Coach" },
      ]),
    ).toEqual(input.messages);
  });

  it("checkpoints before the active context reaches its request cap", () => {
    expect(needsCheckpoint(Array.from({ length: 9 }, () => ({ content: "short" })))).toBe(false);
    expect(needsCheckpoint(Array.from({ length: 10 }, () => ({ content: "short" })))).toBe(true);
    expect(needsCheckpoint([{ content: "界".repeat(14000) }])).toBe(true);
  });
});
