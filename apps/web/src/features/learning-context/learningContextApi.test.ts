import { describe, expect, it, vi } from "vitest";
import { learningContextExport, loadLearningContext, reviewInference } from "./learningContextApi";

const id = "25d64b95-b7cc-4fe5-91ac-ae296dc66383";
const now = "2026-09-14T12:00:00.000Z";
const context = {
  userSupplied: { goals: [], teachingPreferences: [] },
  observed: { attempts: [], summaries: [] },
  inferred: [],
  exportedAt: now,
};

describe("learning context client", () => {
  it("loads authenticated context without caching", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(context), { status: 200 }));
    await expect(
      loadLearningContext("https://api.example.com/", "token", fetcher),
    ).resolves.toEqual(context);
    expect(fetcher).toHaveBeenCalledWith("https://api.example.com/learning-context", {
      cache: "no-store",
      headers: { authorization: "Bearer token" },
    });
  });

  it("sends explicit inference review actions", async () => {
    const inference = {
      id,
      category: "Practice habit",
      content: "Pause before implementation.",
      confidence: 0.8,
      lastObservedAt: now,
      lifecycleState: "ACTIVE",
      approvalState: "APPROVED",
      reviewedAt: now,
      evidence: [{ type: "CONVERSATION_SUMMARY", id, label: "Coach: pacing", occurredAt: now }],
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(inference), { status: 200 }));
    await reviewInference("https://api.example.com", "token", id, { action: "APPROVE" }, fetcher);
    const options = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(options.method).toBe("PATCH");
    expect(JSON.parse(String(options.body))).toEqual({ action: "APPROVE" });
  });

  it("exports only validated structured context", () => {
    expect(JSON.parse(learningContextExport(context))).toEqual(context);
    expect(() => learningContextExport({ ...context, transcript: [] } as never)).toThrow();
  });
});
