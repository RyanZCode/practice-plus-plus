import { describe, expect, it, vi } from "vitest";
import { generateAssessmentDraft, loadAssessmentDraft } from "./assessmentApi";

const attemptId = "6931f7d2-86fc-43de-b7db-dcc636528fc1";
const draft = {
  id: "d3b65a55-1a50-43e1-82e0-e23a263925a5",
  attemptId,
  outcome: "ASSISTED",
  confidence: null,
  optimality: null,
  timeSpentSeconds: null,
  approach: null,
  notes: null,
  reproducedFromMemory: null,
  summary: null,
  evidence: ["ATTEMPT"],
  createdAt: "2026-09-14T12:00:00.000Z",
  updatedAt: "2026-09-14T12:00:00.000Z",
};

describe("assessment draft client", () => {
  it("loads a saved draft without caching", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ draft }), { status: 200 }));
    expect(
      await loadAssessmentDraft("https://api.example.com/", "token", attemptId, fetcher),
    ).toEqual(draft);
    expect(fetcher).toHaveBeenCalledWith(
      `https://api.example.com/ai/assessment-drafts/${attemptId}`,
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("posts provider credentials only in the transient generation request", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(draft), { status: 200 }));
    const input = {
      selection: { providerId: "openai" as const, model: "test-model" },
      apiKey: "private-key",
      attemptId,
      completedCode: "const answer = solve(input);",
      tutorMessages: [{ role: "user" as const, content: "I was stuck on the invariant." }],
    };
    expect(
      await generateAssessmentDraft("https://api.example.com", "token", input, fetcher),
    ).toEqual(draft);
    const options = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.example.com/ai/assessment-drafts");
    expect(options.cache).toBe("no-store");
    expect(JSON.parse(String(options.body))).toEqual(input);
  });
});
