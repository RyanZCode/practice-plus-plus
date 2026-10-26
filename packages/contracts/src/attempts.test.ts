import { suggestedFollowUp } from "./index.js";
import { describe, expect, it } from "vitest";
import {
  attemptAssessmentDraftInputSchema,
  attemptAssessmentRequestSchema,
  confirmAttemptSchema,
  suggestedOutcome,
} from "./index.js";

describe("attempt confirmation", () => {
  it("accepts an editable structured summary but rejects raw transcript fields", () => {
    const summary = {
      approach: "Tracked seen values.",
      stuckPoint: null,
      misconception: null,
      assistance: null,
      progressTrigger: null,
      finalUnderstanding: "Explained the lookup invariant.",
      nextTeachingAction: null,
    };
    expect(confirmAttemptSchema.safeParse({ outcome: "INDEPENDENT", summary }).success).toBe(true);
    expect(
      confirmAttemptSchema.safeParse({
        outcome: "INDEPENDENT",
        summary: { ...summary, transcript: [] },
      }).success,
    ).toBe(false);
  });
  it.each([
    { type: "CUSTOM_DATE" },
    { type: "CUSTOM_DATE", dueDate: "2026-02-30" },
    { type: "TRANSFER", pattern: "secret" },
    { type: "TRANSFER" },
    { type: "REPEAT", dueDate: "2026-09-12" },
    { type: "COMPLETE", pattern: "Trees" },
  ])("rejects malformed next actions %j", (nextAction) => {
    expect(confirmAttemptSchema.safeParse({ outcome: "INDEPENDENT", nextAction }).success).toBe(
      false,
    );
  });
  it.each(["INDEPENDENT", "ASSISTED", "GAVE_UP"])(
    "accepts %s without optional details",
    (outcome) => {
      expect(confirmAttemptSchema.parse({ outcome })).toMatchObject({
        outcome,
        assistance: [],
        confidence: null,
      });
    },
  );
  it("rejects incomplete as a confirmed result", () => {
    expect(confirmAttemptSchema.safeParse({ outcome: "INCOMPLETE" }).success).toBe(false);
  });
  it.each([
    {},
    { outcome: "REDO" },
    { outcome: "INDEPENDENT", sourceCode: "secret" },
    { outcome: "INDEPENDENT", userProfileId: "other" },
    { outcome: "INDEPENDENT", timeSpentSeconds: -1 },
    { outcome: "ASSISTED", assistance: [{ type: "DEBUGGING", hintLevel: 1 }] },
    { outcome: "ASSISTED", assistance: [{ type: "CONCEPTUAL_HINT", hintLevel: 0 }] },
    { outcome: "ASSISTED", assistance: [{ type: "CONCEPTUAL_HINT", hintLevel: 32768 }] },
  ])("rejects invalid confirmation %j", (input) => {
    expect(confirmAttemptSchema.safeParse(input).success).toBe(false);
  });
  it("prefills from the strongest help without choosing an outcome for clarification alone", () => {
    expect(suggestedOutcome([])).toBeNull();
    expect(suggestedOutcome([{ type: "CLARIFICATION", hintLevel: null }])).toBeNull();
    expect(suggestedOutcome([{ type: "CONCEPTUAL_HINT", hintLevel: 2 }])).toBe("ASSISTED");
    expect(suggestedOutcome([{ type: "CONCEPTUAL_HINT", hintLevel: 4 }])).toBe("ASSISTED");
    expect(
      suggestedOutcome([
        { type: "CONCEPTUAL_HINT", hintLevel: 2 },
        { type: "SOLUTION_REVIEW", hintLevel: null },
      ]),
    ).toBe("GAVE_UP");
  });
});

describe("attempt assessment draft", () => {
  const draft = {
    outcome: "ASSISTED",
    confidence: null,
    optimality: null,
    timeSpentSeconds: null,
    approach: "Tracked a moving frontier.",
    notes: null,
    reproducedFromMemory: null,
    summary: null,
    evidence: ["ATTEMPT", "ASSISTANCE_EVENTS"],
  };

  it("accepts bounded structured evidence", () => {
    expect(attemptAssessmentDraftInputSchema.parse(draft)).toEqual(draft);
  });

  it("accepts completed code only as transient assessment input", () => {
    const request = {
      selection: { providerId: "openai", model: "test-model" },
      apiKey: "private-key",
      attemptId: "6931f7d2-86fc-43e1-82e0-e23a263925a5",
      completedCode: "const answer = solve(input);",
      currentSummary: {
        approach: "Tracked a moving frontier.",
        stuckPoint: null,
        misconception: null,
        assistance: null,
        progressTrigger: null,
        finalUnderstanding: null,
        nextTeachingAction: null,
      },
      tutorMessages: [{ role: "user", content: "I was stuck on the invariant." }],
    };
    expect(attemptAssessmentRequestSchema.parse(request).completedCode).toBe(request.completedCode);
    expect(attemptAssessmentRequestSchema.parse(request).tutorMessages).toEqual(
      request.tutorMessages,
    );
    expect(
      attemptAssessmentRequestSchema.safeParse({
        ...request,
        completedCode: "x".repeat(16001),
      }).success,
    ).toBe(false);
  });

  it.each([
    { ...draft, transcript: [] },
    { ...draft, sourceCode: "private" },
    { ...draft, approach: "`const privateCode = true`" },
    { ...draft, evidence: [] },
    { ...draft, evidence: ["RAW_MESSAGES"] },
    { ...draft, evidence: ["ATTEMPT", "ATTEMPT"] },
  ])("rejects content or evidence outside the draft contract", (input) => {
    expect(attemptAssessmentDraftInputSchema.safeParse(input).success).toBe(false);
  });
});

describe("suggested follow-up", () => {
  it.each([
    ["INDEPENDENT", null, null, undefined, "COMPLETE"],
    ["INDEPENDENT", "CONFIDENT", "OPTIMAL", undefined, "COMPLETE"],
    ["INDEPENDENT", "SHAKY", null, undefined, "TRANSFER"],
    ["INDEPENDENT", null, "SUBOPTIMAL", undefined, "TRANSFER"],
    ["ASSISTED", null, null, undefined, "TRANSFER"],
    ["GAVE_UP", null, null, undefined, "REPEAT"],
    ["INDEPENDENT", "SHAKY", "SUBOPTIMAL", "TRANSFER", "COMPLETE"],
    ["ASSISTED", "CONFIDENT", "OPTIMAL", "TRANSFER", "TRANSFER"],
    ["GAVE_UP", null, null, "TRANSFER", "REPEAT"],
    ["INDEPENDENT", "CONFIDENT", "OPTIMAL", "REPAIR", "TRANSFER"],
    ["ASSISTED", null, null, "REPAIR", "TRANSFER"],
    ["INCOMPLETE", null, null, undefined, "COMPLETE"],
  ] as const)(
    "suggests %s / %s / %s / %s => %s",
    (outcome, confidence, optimality, followUpContext, expected) => {
      expect(suggestedFollowUp({ outcome, confidence, optimality, followUpContext })).toBe(
        expected,
      );
    },
  );
});
