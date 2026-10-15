import { describe, expect, it } from "vitest";
import type { Attempt } from "@practice-plus-plus/contracts";
import { externalAiRequest, externalAiSelections } from "./ExternalAiExport";

const attempt = (outcome: Attempt["outcome"]) =>
  ({ id: "5e50a86e-e025-4aec-814c-c978bcc7d02f", outcome }) as Attempt;

describe("contextual external AI tools", () => {
  it("keeps coaching separate from attempt help and planning", () => {
    expect(externalAiSelections(null)).toEqual([["COACH", "General coaching"]]);
    expect(externalAiRequest("PLANNING", null, "")).toEqual({
      policy: { mode: "COACH", purpose: "PLANNING" },
    });
  });

  it("offers only the stages allowed by the reported outcome", () => {
    expect(externalAiSelections(attempt(null)).map(([stage]) => stage)).toEqual([
      "INDEPENDENT",
      "CLARIFICATION",
      "HINT_1",
      "HINT_2",
      "HINT_3",
      "DEBUGGING",
      "OPTIMIZATION",
    ]);
    expect(externalAiSelections(attempt("GAVE_UP")).map(([stage]) => stage)).toEqual([
      "SOLUTION_REVIEW",
      "RESULT",
    ]);
    for (const outcome of ["INDEPENDENT", "ASSISTED", "INCOMPLETE"] as const)
      expect(externalAiSelections(attempt(outcome)).map(([stage]) => stage)).toEqual(["RESULT"]);
  });

  it("preserves explicit hint levels and includes code only for debugging", () => {
    for (const [stage, level] of [
      ["HINT_1", 1],
      ["HINT_2", 2],
      ["HINT_3", 3],
    ] as const)
      expect(externalAiRequest(stage, attempt(null), "private code")).toEqual({
        policy: {
          mode: "ATTEMPT_TUTOR",
          attemptId: attempt(null).id,
          phase: "HELP",
          help: "CONCEPTUAL_HINT",
          hintLevel: level,
        },
      });
    expect(externalAiRequest("DEBUGGING", attempt(null), "  private code  ")).toMatchObject({
      currentCode: "  private code  ",
    });
    expect(externalAiRequest("RESULT", attempt("ASSISTED"), "private code")).not.toHaveProperty(
      "currentCode",
    );
    expect(() => externalAiRequest("INDEPENDENT", null, "")).toThrow("Start or resume");
  });
});
