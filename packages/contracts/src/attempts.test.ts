import { describe, expect, it } from "vitest";
import {
  attemptAssessmentDraftInputSchema,
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
  it.each(["INDEPENDENT", "ASSISTED", "GAVE_UP", "INCOMPLETE"])(
    "accepts %s without optional details",
    (outcome) => {
      expect(confirmAttemptSchema.parse({ outcome })).toMatchObject({
        outcome,
        assistance: [],
        confidence: null,
      });
    },
  );
  it.each([
    {},
    { outcome: "REDO" },
    { outcome: "INDEPENDENT", sourceCode: "secret" },
    { outcome: "INDEPENDENT", userProfileId: "other" },
    { outcome: "INDEPENDENT", timeSpentSeconds: -1 },
    { outcome: "ASSISTED", assistance: [{ type: "DEBUGGING", hintLevel: 1 }] },
    { outcome: "ASSISTED", assistance: [{ type: "CONCEPTUAL_HINT", hintLevel: 0 }] },
  ])("rejects invalid confirmation %j", (input) => {
    expect(confirmAttemptSchema.safeParse(input).success).toBe(false);
  });
  it("prefills from the strongest help without choosing an outcome for clarification alone", () => {
    expect(suggestedOutcome([])).toBeNull();
    expect(suggestedOutcome([{ type: "CLARIFICATION", hintLevel: null }])).toBeNull();
    expect(suggestedOutcome([{ type: "CONCEPTUAL_HINT", hintLevel: 2 }])).toBe("ASSISTED");
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
