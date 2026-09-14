import { describe, expect, it } from "vitest";
import {
  attemptSummaryInputSchema,
  conversationSummaryInputSchema,
  learnerGoalInputSchema,
  learnerMemorySchema,
  memoryEvidenceSchema,
  memorySuggestionInputSchema,
  memorySuggestionSchema,
  rollingSummaryOutputSchema,
  rejectedMemorySuggestionSchema,
  teachingPreferenceInputSchema,
} from "./index.js";

const id = "25d64b95-b7cc-4fe5-91ac-ae296dc66383";
const observedAt = "2026-09-11T12:00:00.000Z";
const suggestion = {
  category: "Recurring misconception",
  content: "Confuses a visited node with a node in the current traversal path.",
  confidence: 0.7,
  lastObservedAt: observedAt,
  lifecycleState: "ACTIVE",
  evidence: [{ type: "ATTEMPT", attemptId: id }],
};
const summary = {
  approach: "Tracked previously visited nodes.",
  stuckPoint: "Distinguishing a cycle from a shared descendant.",
  misconception: null,
  assistance: "A conceptual hint separated the two cases.",
  progressTrigger: null,
  finalUnderstanding: "Explained the difference using a small graph.",
  nextTeachingAction: "Ask for the invariant before another example.",
};

describe("learner context contracts", () => {
  it("accepts declarations without allowing a caller to supply ownership", () => {
    const goal = { target: " Prepare for interviews ", priority: 0, state: "ACTIVE" };
    expect(learnerGoalInputSchema.parse(goal).target).toBe("Prepare for interviews");
    expect(
      teachingPreferenceInputSchema.parse({ preference: "Ask one question at a time." }),
    ).toBeDefined();
    expect(learnerGoalInputSchema.safeParse({ ...goal, userProfileId: id }).success).toBe(false);
    expect(learnerGoalInputSchema.safeParse({ ...goal, priority: -1 }).success).toBe(false);
    expect(teachingPreferenceInputSchema.safeParse({ preference: " " }).success).toBe(false);
  });

  it("allows unknown summary details without inventing learning evidence", () => {
    expect(attemptSummaryInputSchema.parse(summary)).toEqual(summary);
    expect(attemptSummaryInputSchema.safeParse({ approach: summary.approach }).success).toBe(false);
    expect(
      attemptSummaryInputSchema.safeParse({ ...summary, approach: "x".repeat(1001) }).success,
    ).toBe(false);
    expect(
      attemptSummaryInputSchema.safeParse({ ...summary, reviewedAt: observedAt }).success,
    ).toBe(false);
  });

  it.each(["messages", "transcript", "prompt", "response", "pastedCode", "submittedCode"])(
    "rejects a raw %s storage field",
    (field) => {
      expect(
        attemptSummaryInputSchema.safeParse({ ...summary, [field]: "raw content" }).success,
      ).toBe(false);
      expect(
        memorySuggestionInputSchema.safeParse({ ...suggestion, [field]: "raw content" }).success,
      ).toBe(false);
    },
  );

  it("rejects fenced code excerpts in learning text", () => {
    expect(
      attemptSummaryInputSchema.safeParse({ ...summary, approach: "```js\nreturn 1;\n```" })
        .success,
    ).toBe(false);
    expect(
      memorySuggestionInputSchema.safeParse({ ...suggestion, content: "~~~python\npass\n~~~" })
        .success,
    ).toBe(false);
  });

  it("validates bounded structured checkpoint output without transcript fields", () => {
    const output = {
      summary: { topics: "Practice pacing", learningProgress: null, nextSteps: null },
      attemptSummary: null,
      memorySuggestions: [
        {
          category: "Practice habit",
          content: "May benefit from pausing before implementation.",
          confidence: 0.7,
          lifecycleState: "ACTIVE",
        },
      ],
    };
    expect(rollingSummaryOutputSchema.safeParse(output).success).toBe(true);
    expect(rollingSummaryOutputSchema.safeParse({ ...output, transcript: [] }).success).toBe(false);
    expect(
      rollingSummaryOutputSchema.safeParse({
        ...output,
        summary: { ...output.summary, topics: "`return result`" },
      }).success,
    ).toBe(false);
  });

  it("requires an attempt for tutoring summaries and excludes it from coach summaries", () => {
    const conversation = {
      topics: "Reviewing practice goals",
      learningProgress: null,
      nextSteps: null,
    };
    expect(
      conversationSummaryInputSchema.safeParse({ ...conversation, mode: "COACH", attemptId: null })
        .success,
    ).toBe(true);
    expect(
      conversationSummaryInputSchema.safeParse({
        ...conversation,
        mode: "ATTEMPT_TUTOR",
        attemptId: id,
      }).success,
    ).toBe(true);
    expect(
      conversationSummaryInputSchema.safeParse({ ...conversation, mode: "COACH", attemptId: id })
        .success,
    ).toBe(false);
    expect(
      conversationSummaryInputSchema.safeParse({
        ...conversation,
        mode: "ATTEMPT_TUTOR",
        attemptId: null,
      }).success,
    ).toBe(false);
    expect(
      conversationSummaryInputSchema.safeParse({
        ...conversation,
        mode: "COACH",
        attemptId: null,
        messages: [],
      }).success,
    ).toBe(false);
  });

  it("keeps pending and rejected suggestions out of the approved-memory contract", () => {
    const pending = { ...suggestion, id, approvalState: "PENDING", reviewedAt: null };
    const approved = { ...pending, approvalState: "APPROVED", reviewedAt: observedAt };
    const rejected = { ...pending, approvalState: "REJECTED", reviewedAt: observedAt };
    expect(memorySuggestionSchema.safeParse(pending).success).toBe(true);
    expect(learnerMemorySchema.safeParse(pending).success).toBe(false);
    expect(learnerMemorySchema.safeParse(rejected).success).toBe(false);
    expect(rejectedMemorySuggestionSchema.safeParse(rejected).success).toBe(true);
    expect(learnerMemorySchema.safeParse(approved).success).toBe(true);
    expect(memorySuggestionSchema.safeParse(approved).success).toBe(false);
    expect(learnerMemorySchema.safeParse({ ...approved, reviewedAt: null }).success).toBe(false);
    expect(
      memorySuggestionInputSchema.safeParse({ ...suggestion, approvalState: "APPROVED" }).success,
    ).toBe(false);
  });

  it("allows invalidated suggestions with no remaining evidence, but never approves them", () => {
    const pending = { ...suggestion, id, approvalState: "PENDING", reviewedAt: null, evidence: [] };
    expect(memorySuggestionSchema.safeParse(pending).success).toBe(true);
    expect(memorySuggestionInputSchema.safeParse({ ...suggestion, evidence: [] }).success).toBe(
      false,
    );
    expect(
      learnerMemorySchema.safeParse({
        ...pending,
        approvalState: "APPROVED",
        reviewedAt: observedAt,
      }).success,
    ).toBe(false);
  });

  it.each([-0.1, 1.1, NaN, Infinity])("rejects invalid confidence %s", (confidence) => {
    expect(memorySuggestionInputSchema.safeParse({ ...suggestion, confidence }).success).toBe(
      false,
    );
  });

  it.each(["ACTIVE", "IMPROVING", "RESOLVED"])(
    "retains %s lifecycle independently of approval",
    (lifecycleState) => {
      expect(memorySuggestionInputSchema.safeParse({ ...suggestion, lifecycleState }).success).toBe(
        true,
      );
    },
  );

  it("requires a typed, unambiguous evidence source", () => {
    for (const evidence of [
      { type: "LEARNER_GOAL", learnerGoalId: id },
      { type: "TEACHING_PREFERENCE", teachingPreferenceId: id },
      { type: "ATTEMPT", attemptId: id },
      { type: "ASSISTANCE_EVENT", assistanceEventId: id, attemptId: id },
      { type: "ATTEMPT_SUMMARY", attemptId: id },
      { type: "CONVERSATION_SUMMARY", conversationSummaryId: id },
    ])
      expect(memoryEvidenceSchema.safeParse(evidence).success).toBe(true);
    expect(memoryEvidenceSchema.safeParse({ type: "ATTEMPT", attemptId: "missing" }).success).toBe(
      false,
    );
    expect(
      memoryEvidenceSchema.safeParse({ type: "ATTEMPT", attemptId: id, learnerGoalId: id }).success,
    ).toBe(false);
    expect(
      memoryEvidenceSchema.safeParse({ type: "ASSISTANCE_EVENT", assistanceEventId: id }).success,
    ).toBe(false);
  });
});
