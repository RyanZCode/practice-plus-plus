import { attemptAssessmentDraftSchema } from "@practice-plus-plus/contracts";
import { expect, it } from "vitest";
import { assessmentFields } from "./assessmentFields";

it("omits unspecified suggestions so regenerating a draft preserves existing edits", () => {
  const draft = attemptAssessmentDraftSchema.parse({
    id: "10000000-0000-4000-8000-000000000001",
    attemptId: "10000000-0000-4000-8000-000000000002",
    outcome: "GAVE_UP",
    confidence: null,
    optimality: "SUBOPTIMAL",
    timeSpentSeconds: 0,
    approach: null,
    notes: null,
    reproducedFromMemory: false,
    summary: {
      approach: "Used a stack",
      stuckPoint: null,
      misconception: null,
      assistance: null,
      progressTrigger: null,
      finalUnderstanding: null,
      nextTeachingAction: null,
    },
    evidence: ["ATTEMPT"],
    createdAt: "2026-10-20T12:00:00.000Z",
    updatedAt: "2026-10-20T12:00:00.000Z",
  });
  expect(assessmentFields(draft)).toEqual({
    outcome: "GAVE_UP",
    optimality: "SUBOPTIMAL",
    minutes: "0",
    reproduced: "false",
    "summary.approach": "Used a stack",
  });
  expect(assessmentFields({ ...draft, timeSpentSeconds: 90 }).minutes).toBe("1.5");
});
