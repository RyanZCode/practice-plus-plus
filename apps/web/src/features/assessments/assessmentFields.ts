import type { AttemptAssessmentDraft } from "@practice-plus-plus/contracts";

export function assessmentFields(draft: AttemptAssessmentDraft): Record<string, string> {
  const fields: Record<string, string | number | boolean | null> = {
    outcome: draft.outcome,
    confidence: draft.confidence,
    optimality: draft.optimality,
    minutes: draft.timeSpentSeconds === null ? null : draft.timeSpentSeconds / 60,
    approach: draft.approach,
    notes: draft.notes,
    reproduced: draft.reproducedFromMemory,
    ...Object.fromEntries(
      Object.entries(draft.summary ?? {}).map(([key, value]) => [`summary.${key}`, value]),
    ),
  };
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([, value]) => value !== null)
      .map(([key, value]) => [key, String(value)]),
  );
}
