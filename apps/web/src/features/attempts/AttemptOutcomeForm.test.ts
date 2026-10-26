import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { attemptSchema, type Attempt } from "@practice-plus-plus/contracts";
import { describe, expect, it, vi } from "vitest";
import { AttemptOutcomeForm } from "./AttemptOutcomeForm";

function render(overrides: Partial<Attempt>) {
  const attempt = attemptSchema.parse({
    id: "d3b65a55-1a50-43e1-82e0-e23a263925a5",
    type: "FRESH",
    practiceDate: "2026-10-25",
    startedAt: "2026-10-25T12:00:00.000Z",
    timerSkippedAt: null,
    confirmedAt: null,
    solutionReviewedAt: null,
    outcome: "ASSISTED",
    confidence: null,
    optimality: null,
    timeSpentSeconds: null,
    approach: null,
    notes: null,
    reproducedFromMemory: null,
    assistance: [],
    patterns: ["Arrays & Hashing"],
    problem: {
      id: "6931f7d2-86fc-43de-b7db-dcc636528fc1",
      leetcodeId: 1,
      title: "Two Sum",
      slug: "two-sum",
      url: "https://leetcode.com/problems/two-sum/",
      difficulty: "EASY",
      availability: "AVAILABLE",
    },
    ...overrides,
  });
  return renderToStaticMarkup(
    createElement(AttemptOutcomeForm, {
      attempt,
      busy: false,
      memorySuggestions: [],
      assessmentDraft: null,
      canDraftAssessment: false,
      completedCode: "",
      onCompletedCodeChange: vi.fn(),
      onLearningProfile: vi.fn(),
      onDraftAssessment: vi.fn().mockResolvedValue(null),
      onConfirm: vi.fn().mockResolvedValue(undefined),
      onReport: vi.fn().mockResolvedValue(undefined),
    }),
  );
}

describe("follow-up choices", () => {
  it("suggests a transfer on a fresh assisted solve with a revealed pattern selected", () => {
    const html = render({});
    expect(html).toContain('<option value="TRANSFER" selected="">');
    expect(html).toContain('<option selected="">Arrays &amp; Hashing</option>');
    expect(html).toContain("configured medium interval");
    expect(html).not.toContain("7 calendar days");
  });
  it("finishes an independent transfer and suggests a transfer after a repair", () => {
    expect(render({ outcome: "INDEPENDENT", followUpContext: "TRANSFER" })).toContain(
      '<option value="COMPLETE" selected="">',
    );
    expect(render({ outcome: "INDEPENDENT", type: "REDO", followUpContext: "REPAIR" })).toContain(
      '<option value="TRANSFER" selected="">',
    );
  });
  it("defaults to a repeat after giving up while keeping manual choices available", () => {
    const html = render({ outcome: "GAVE_UP", followUpContext: "TRANSFER" });
    expect(html).toContain('<option value="REPEAT" selected="">');
    expect(html).toContain('<option value="COMPLETE">');
    expect(html).not.toContain('value="INCOMPLETE"');
  });
});
