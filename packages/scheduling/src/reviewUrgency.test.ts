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

  it.each(["GAVE_UP", "INCOMPLETE"] as const)("gives %s high priority", (outcome) => {
    expect(deriveReviewUrgency({ ...confirmedAttempt, assistance: [], outcome })).toBe("HIGH");
    expect(
      deriveReviewUrgency({
        ...confirmedAttempt,
        outcome,
        confidence: "CONFIDENT",
        optimality: "OPTIMAL",
        assistance: help("CLARIFICATION"),
      }),
    ).toBe("HIGH");
  });

  const combinations: [Assistance["type"][], ReviewUrgency][] = [
    [[], "MEDIUM"],
    [["CLARIFICATION"], "LOW"],
    [["OPTIMIZATION"], "LOW"],
    [["CLARIFICATION", "OPTIMIZATION"], "LOW"],
    [["DEBUGGING"], "MEDIUM"],
    [["CLARIFICATION", "DEBUGGING"], "MEDIUM"],
    [["OPTIMIZATION", "DEBUGGING"], "MEDIUM"],
    [["CLARIFICATION", "OPTIMIZATION", "DEBUGGING"], "MEDIUM"],
    [["CONCEPTUAL_HINT"], "HIGH"],
    [["CLARIFICATION", "CONCEPTUAL_HINT"], "HIGH"],
    [["OPTIMIZATION", "CONCEPTUAL_HINT"], "HIGH"],
    [["DEBUGGING", "CONCEPTUAL_HINT"], "HIGH"],
    [["CLARIFICATION", "OPTIMIZATION", "CONCEPTUAL_HINT"], "HIGH"],
    [["CLARIFICATION", "DEBUGGING", "CONCEPTUAL_HINT"], "HIGH"],
    [["OPTIMIZATION", "DEBUGGING", "CONCEPTUAL_HINT"], "HIGH"],
    [["CLARIFICATION", "OPTIMIZATION", "DEBUGGING", "CONCEPTUAL_HINT"], "HIGH"],
  ];

  it.each(combinations)("combines %j with confidence and quality", (types, urgency) => {
    const confidences: Attempt["confidence"][] = ["CONFIDENT", "SHAKY", null];
    const qualities: Attempt["optimality"][] = ["OPTIMAL", "SUBOPTIMAL", "UNKNOWN", null];
    for (const confidence of confidences) {
      for (const optimality of qualities) {
        const expected =
          confidence === "SHAKY" || urgency === "HIGH"
            ? "HIGH"
            : confidence === "CONFIDENT" && optimality === "OPTIMAL"
              ? urgency
              : "MEDIUM";
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
