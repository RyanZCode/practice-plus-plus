import { describe, expect, it } from "vitest";
import { confirmAttemptSchema, suggestedOutcome } from "./index.js";

describe("attempt confirmation", () => {
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
