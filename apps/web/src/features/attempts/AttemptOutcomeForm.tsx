import {
  suggestedOutcome,
  redoNextActionSchema,
  type Assistance,
  type Attempt,
  type AttemptAssessmentDraft,
  type ConfirmAttempt,
  type MemorySuggestion,
  type ReportAttempt,
} from "@practice-plus-plus/contracts";
import { useState } from "react";

const assistanceOptions: { type: Assistance["type"]; label: string }[] = [
  { type: "CLARIFICATION", label: "Clarification" },
  { type: "CONCEPTUAL_HINT", label: "Conceptual hint" },
  { type: "DEBUGGING", label: "Debugging" },
  { type: "OPTIMIZATION", label: "Optimization" },
  { type: "SOLUTION_REVIEW", label: "Editorial or solution review" },
];

export function AttemptOutcomeForm({
  attempt,
  busy,
  onConfirm,
  onReport,
  memorySuggestions,
  assessmentDraft,
  canDraftAssessment,
  onDraftAssessment,
}: {
  attempt: Attempt;
  busy: boolean;
  memorySuggestions: MemorySuggestion[];
  assessmentDraft: AttemptAssessmentDraft | null;
  canDraftAssessment: boolean;
  onDraftAssessment: () => Promise<void>;
  onConfirm: (input: ConfirmAttempt) => Promise<void>;
  onReport: (input: ReportAttempt) => Promise<void>;
}) {
  const [outcome, setOutcome] = useState<ConfirmAttempt["outcome"] | "">(
    assessmentDraft?.outcome ?? attempt.outcome ?? suggestedOutcome(attempt.assistance) ?? "",
  );
  const [assistance, setAssistance] = useState<Assistance[]>([]);
  const [reproduced, setReproduced] = useState<boolean | null>(
    assessmentDraft?.reproducedFromMemory ?? null,
  );
  const [selectedAction, setSelectedAction] = useState<string>();
  const [summary, setSummary] = useState({
    approach: assessmentDraft?.summary?.approach ?? attempt.summary?.approach ?? "",
    stuckPoint: assessmentDraft?.summary?.stuckPoint ?? attempt.summary?.stuckPoint ?? "",
    misconception: assessmentDraft?.summary?.misconception ?? attempt.summary?.misconception ?? "",
    assistance: assessmentDraft?.summary?.assistance ?? attempt.summary?.assistance ?? "",
    progressTrigger:
      assessmentDraft?.summary?.progressTrigger ?? attempt.summary?.progressTrigger ?? "",
    finalUnderstanding:
      assessmentDraft?.summary?.finalUnderstanding ?? attempt.summary?.finalUnderstanding ?? "",
    nextTeachingAction:
      assessmentDraft?.summary?.nextTeachingAction ?? attempt.summary?.nextTeachingAction ?? "",
  });
  const successfulRedo =
    attempt.type === "REDO" && (outcome === "INDEPENDENT" || outcome === "ASSISTED");
  const nextActionType = selectedAction ?? "";
  const required = suggestedOutcome([...attempt.assistance, ...assistance]);
  const reviewed = required === "GAVE_UP";
  const canConfirm = outcome === "INCOMPLETE" || attempt.outcome !== null;

  function toggleHelp(type: Assistance["type"], checked: boolean) {
    const next = checked
      ? [...assistance, { type, hintLevel: null }]
      : assistance.filter((event) => event.type !== type);
    setAssistance(next);
    const suggestion = suggestedOutcome([...attempt.assistance, ...next]);
    if (suggestion !== null) setOutcome(attempt.outcome === "GAVE_UP" ? "GAVE_UP" : suggestion);
    if (type === "SOLUTION_REVIEW") setReproduced(null);
  }

  return (
    <form
      className="outcome-form page-surface"
      onSubmit={(event) => {
        event.preventDefault();
        if (outcome === "" || !canConfirm) return;
        const data = new FormData(event.currentTarget);
        const text = (name: string) => String(data.get(name) ?? "").trim() || null;
        const minutes = text("minutes");
        const reviewedSummary = Object.fromEntries(
          Object.entries(summary).map(([key, value]) => [key, value.trim() || null]),
        ) as NonNullable<ConfirmAttempt["summary"]>;
        void onConfirm({
          ...(successfulRedo && nextActionType !== ""
            ? {
                nextAction: redoNextActionSchema.parse({
                  type: nextActionType,
                  ...(nextActionType === "TRANSFER" ? { pattern: text("transferPattern") } : {}),
                  ...(nextActionType === "CUSTOM_DATE" ||
                  (nextActionType === "TRANSFER" && text("dueDate") !== null)
                    ? { dueDate: text("dueDate") }
                    : {}),
                }),
              }
            : {}),
          outcome,
          confidence: text("confidence") as ConfirmAttempt["confidence"],
          optimality: text("optimality") as ConfirmAttempt["optimality"],
          assistance,
          timeSpentSeconds: minutes === null ? null : Math.round(Number(minutes) * 60),
          approach: text("approach"),
          notes: text("notes"),
          reproducedFromMemory: reviewed ? reproduced : null,
          summary: Object.values(reviewedSummary).every((value) => value === null)
            ? null
            : reviewedSummary,
        });
      }}
    >
      <fieldset disabled={busy}>
        <legend>Confirm attempt outcome</legend>
        <label>
          Outcome
          <select
            required
            value={outcome}
            onChange={(event) => setOutcome(event.target.value as typeof outcome)}
          >
            <option value="" disabled>
              Select an outcome
            </option>
            <option
              value="INDEPENDENT"
              disabled={
                required !== null || attempt.outcome === "ASSISTED" || attempt.outcome === "GAVE_UP"
              }
            >
              Independent: solved without substantive help
            </option>
            <option value="ASSISTED" disabled={reviewed || attempt.outcome === "GAVE_UP"}>
              Assisted: solved with help
            </option>
            <option value="GAVE_UP">Gave up</option>
            <option value="INCOMPLETE" disabled={reviewed || attempt.outcome !== null}>
              Incomplete: stopped without a result
            </option>
          </select>
        </label>
        {!canConfirm ? (
          <button
            type="button"
            disabled={busy || outcome === ""}
            onClick={() => {
              if (outcome !== "") void onReport({ outcome });
            }}
          >
            Report result and reveal patterns
          </button>
        ) : null}
        {attempt.outcome !== null ? (
          <p>
            Result reported. You can review the optional details before confirming. This attempt can
            no longer be incomplete.
          </p>
        ) : null}
        {attempt.outcome !== null ? (
          <div>
            <button
              type="button"
              className="secondary-button"
              disabled={busy || !canDraftAssessment}
              onClick={() => void onDraftAssessment()}
            >
              {assessmentDraft === null ? "Draft assessment with AI" : "Regenerate AI draft"}
            </button>
            {!canDraftAssessment ? (
              <p className="settings-help">Add your OpenAI API key in Practice settings first.</p>
            ) : null}
            {assessmentDraft !== null ? (
              <p role="status">
                AI draft applied below. Review and edit every field before confirming. Based on:{" "}
                {assessmentDraft.evidence
                  .map((item) => item.toLowerCase().replaceAll("_", " "))
                  .join(", ")}
                .
              </p>
            ) : null}
          </div>
        ) : null}
        {attempt.assistance.length > 0 ? (
          <p>
            Recorded help:{" "}
            {attempt.assistance
              .map(
                (event) =>
                  `${assistanceOptions.find((option) => option.type === event.type)?.label}${event.hintLevel === null ? "" : ` (level ${event.hintLevel})`}`,
              )
              .join(", ")}
          </p>
        ) : null}
        <details>
          <summary>Other help received (optional)</summary>
          {assistanceOptions
            .filter((option) => !attempt.assistance.some((event) => event.type === option.type))
            .map(({ type, label }) => (
              <label key={type}>
                <input
                  type="checkbox"
                  checked={assistance.some((event) => event.type === type)}
                  onChange={(event) => toggleHelp(type, event.target.checked)}
                />{" "}
                {label}
              </label>
            ))}
          {assistance.some((event) => event.type === "CONCEPTUAL_HINT") ? (
            <label>
              Highest hint level (optional)
              <input
                type="number"
                min="1"
                max="32767"
                step="1"
                onChange={(event) => {
                  const level = event.target.value === "" ? null : Number(event.target.value);
                  setAssistance((current) =>
                    current.map((help) =>
                      help.type === "CONCEPTUAL_HINT" ? { ...help, hintLevel: level } : help,
                    ),
                  );
                }}
              />
            </label>
          ) : null}
        </details>
        {reviewed ? (
          <details>
            <summary>Try the solution from memory (optional)</summary>
            <p>
              Close the reference and try coding the solution without looking. Either result keeps
              the outcome gave up, or you can leave this unanswered.
            </p>
            <label>
              <input
                type="radio"
                name="reproduction"
                checked={reproduced === true}
                onChange={() => setReproduced(true)}
              />{" "}
              I reproduced it from memory
            </label>
            <label>
              <input
                type="radio"
                name="reproduction"
                checked={reproduced === false}
                onChange={() => setReproduced(false)}
              />{" "}
              I could not reproduce it
            </label>
          </details>
        ) : null}
        {canConfirm && successfulRedo ? (
          <fieldset>
            <legend>Next action (optional)</legend>
            {outcome === "ASSISTED" ? (
              <p>
                Leave this unchanged to schedule the normal assisted review, or choose another
                action.
              </p>
            ) : (
              <p>Leave this unchanged to complete the redo without another follow-up.</p>
            )}
            <label>
              After this redo
              <select
                value={nextActionType}
                onChange={(event) => setSelectedAction(event.target.value)}
              >
                <option value="">Use automatic follow-up</option>
                <option value="REPEAT">Repeat this problem using my review interval</option>
                <option value="TRANSFER">Practice a fresh problem with the same pattern</option>
                <option value="COMPLETE">Complete with no follow-up</option>
                <option value="CUSTOM_DATE">Repeat this problem on a custom date</option>
              </select>
            </label>
            {nextActionType === "TRANSFER" ? (
              <>
                <label>
                  Pattern to practice
                  <select name="transferPattern" required defaultValue="">
                    <option value="" disabled>
                      Select a revealed pattern
                    </option>
                    {attempt.patterns?.map((pattern) => (
                      <option key={pattern}>{pattern}</option>
                    ))}
                  </select>
                </label>
                <p>
                  Eligible 7 calendar days after this attempt's practice date. The daily plan will
                  choose the problem when space and a matching fresh problem are available.
                </p>
              </>
            ) : null}
            {nextActionType === "TRANSFER" || nextActionType === "CUSTOM_DATE" ? (
              <label>
                {nextActionType === "TRANSFER"
                  ? "Eligibility date override (optional)"
                  : "Review date"}
                <input
                  key={nextActionType}
                  type="date"
                  name="dueDate"
                  required={nextActionType === "CUSTOM_DATE"}
                />
              </label>
            ) : null}
          </fieldset>
        ) : null}
        {canConfirm ? (
          <details>
            <summary>Optional details</summary>
            <label>
              Confidence
              <select name="confidence" defaultValue={assessmentDraft?.confidence ?? ""}>
                <option value="">Not specified</option>
                <option value="CONFIDENT">Confident</option>
                <option value="SHAKY">Shaky</option>
              </select>
            </label>
            <label>
              Solution quality
              <select name="optimality" defaultValue={assessmentDraft?.optimality ?? ""}>
                <option value="">Not specified</option>
                <option value="OPTIMAL">Optimal</option>
                <option value="SUBOPTIMAL">Suboptimal</option>
                <option value="UNKNOWN">Unknown</option>
              </select>
            </label>
            <label>
              Time spent (minutes)
              <input
                name="minutes"
                type="number"
                min="0"
                max="35791394"
                step="0.1"
                defaultValue={
                  assessmentDraft?.timeSpentSeconds == null
                    ? ""
                    : assessmentDraft.timeSpentSeconds / 60
                }
              />
            </label>
            <label>
              Approach (brief description, no source code)
              <textarea
                name="approach"
                maxLength={1000}
                rows={2}
                defaultValue={assessmentDraft?.approach ?? ""}
              />
            </label>
            <label>
              Notes (no source code)
              <textarea
                name="notes"
                maxLength={5000}
                rows={3}
                defaultValue={assessmentDraft?.notes ?? ""}
              />
            </label>
          </details>
        ) : null}
        {canConfirm ? (
          <details>
            <summary>Learning summary (optional)</summary>
            <p className="settings-help">
              Review or edit this structured summary if useful. Keep it concise and do not include
              source code.
            </p>
            {(
              [
                ["approach", "Approach"],
                ["stuckPoint", "Where I got stuck"],
                ["misconception", "Misconception"],
                ["assistance", "Assistance"],
                ["progressTrigger", "What unlocked progress"],
                ["finalUnderstanding", "Final understanding"],
                ["nextTeachingAction", "Next teaching action"],
              ] as const
            ).map(([field, label]) => (
              <label key={field}>
                {label}
                <textarea
                  rows={2}
                  maxLength={1000}
                  value={summary[field]}
                  onChange={(event) => setSummary({ ...summary, [field]: event.target.value })}
                />
              </label>
            ))}
          </details>
        ) : null}
        {canConfirm && memorySuggestions.length > 0 ? (
          <fieldset>
            <legend>Pending memory suggestions</legend>
            <p className="settings-help">
              These subjective inferences need separate approval and are not used in future AI
              context yet.
            </p>
            <ul>
              {memorySuggestions.map((suggestion) => (
                <li key={suggestion.id}>
                  <strong>{suggestion.category}</strong>: {suggestion.content}
                </li>
              ))}
            </ul>
          </fieldset>
        ) : null}
        {canConfirm ? (
          <button type="submit" disabled={busy || outcome === ""}>
            {successfulRedo ? "Confirm outcome and next action" : "Confirm outcome"}
          </button>
        ) : null}
      </fieldset>
    </form>
  );
}
