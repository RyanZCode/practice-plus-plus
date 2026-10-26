import type { Assistance, Attempt } from "@practice-plus-plus/contracts";
import { describe, expect, it } from "vitest";

import { deriveReviewUrgency, type ReviewUrgency } from "./index.js";

const confirmedAttempt = {
  confirmedAt: "2026-09-08T12:00:00.000Z",
  outcome: "ASSISTED",
  confidence: null,
  optimality: null,
  assistance: [],
} as const;

function help(...types: Assistance["type"][]): Assistance[] {
  return types.map((type) => ({ type, hintLevel: type === "CONCEPTUAL_HINT" ? 1 : null }));
}

describe("deriveReviewUrgency", () => {
  it.each([null, "INDEPENDENT", "ASSISTED", "GAVE_UP", "INCOMPLETE"] as const)(
    "ignores unconfirmed attempts with outcome %s",
    (outcome) => {
      expect(
        deriveReviewUrgency({ ...confirmedAttempt, assistance: [], confirmedAt: null, outcome }),
      ).toBeNull();
    },
  );

  it("ignores an attempt without an outcome", () => {
    expect(deriveReviewUrgency({ ...confirmedAttempt, assistance: [], outcome: null })).toBeNull();
  });

  it.each(["CONFIDENT", "SHAKY", null] as const)(
    "does not schedule independent solves with confidence %s",
    (confidence) => {
      for (const optimality of ["OPTIMAL", "SUBOPTIMAL", "UNKNOWN", null] as const) {
        expect(
          deriveReviewUrgency({
            ...confirmedAttempt,
            outcome: "INDEPENDENT",
            confidence,
            optimality,
            assistance: [],
          }),
        ).toBeNull();
      }
    },
  );

  it("gives gave-up attempts high urgency and ignores legacy incomplete outcomes", () => {
    expect(deriveReviewUrgency({ ...confirmedAttempt, assistance: [], outcome: "GAVE_UP" })).toBe(
      "HIGH",
    );
    expect(
      deriveReviewUrgency({ ...confirmedAttempt, assistance: [], outcome: "INCOMPLETE" }),
    ).toBeNull();
  });

  const combinations: [Assistance["type"][], ReviewUrgency][] = [
    [[], "MEDIUM"],
    [["CLARIFICATION"], "MEDIUM"],
    [["OPTIMIZATION"], "MEDIUM"],
    [["CLARIFICATION", "OPTIMIZATION"], "MEDIUM"],
    [["DEBUGGING"], "MEDIUM"],
    [["CLARIFICATION", "DEBUGGING"], "MEDIUM"],
    [["OPTIMIZATION", "DEBUGGING"], "MEDIUM"],
    [["CLARIFICATION", "OPTIMIZATION", "DEBUGGING"], "MEDIUM"],
    [["CONCEPTUAL_HINT"], "MEDIUM"],
    [["CLARIFICATION", "CONCEPTUAL_HINT"], "MEDIUM"],
    [["OPTIMIZATION", "CONCEPTUAL_HINT"], "MEDIUM"],
    [["DEBUGGING", "CONCEPTUAL_HINT"], "MEDIUM"],
    [["CLARIFICATION", "OPTIMIZATION", "CONCEPTUAL_HINT"], "MEDIUM"],
    [["CLARIFICATION", "DEBUGGING", "CONCEPTUAL_HINT"], "MEDIUM"],
    [["OPTIMIZATION", "DEBUGGING", "CONCEPTUAL_HINT"], "MEDIUM"],
    [["CLARIFICATION", "OPTIMIZATION", "DEBUGGING", "CONCEPTUAL_HINT"], "MEDIUM"],
  ];

  it.each(combinations)("combines %j with confidence and quality", (types, urgency) => {
    const confidences: Attempt["confidence"][] = ["CONFIDENT", "SHAKY", null];
    const qualities: Attempt["optimality"][] = ["OPTIMAL", "SUBOPTIMAL", "UNKNOWN", null];
    for (const confidence of confidences) {
      for (const optimality of qualities) {
        const expected = urgency;
        const attempt = {
          ...confirmedAttempt,
          confidence,
          optimality,
          assistance: help(...types),
        };
        expect(deriveReviewUrgency(attempt), JSON.stringify(attempt)).toBe(expected);
        expect(deriveReviewUrgency({ ...attempt, assistance: help(...types.toReversed()) })).toBe(
          expected,
        );
      }
    }
  });
});
