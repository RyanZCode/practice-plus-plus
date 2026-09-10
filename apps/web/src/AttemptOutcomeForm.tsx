import {
  suggestedOutcome,
  redoNextActionSchema,
  type Assistance,
  type Attempt,
  type ConfirmAttempt,
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
}: {
  attempt: Attempt;
  busy: boolean;
  onConfirm: (input: ConfirmAttempt) => Promise<void>;
  onReport: (input: ReportAttempt) => Promise<void>;
}) {
  const [outcome, setOutcome] = useState<ConfirmAttempt["outcome"] | "">(
    attempt.outcome ?? suggestedOutcome(attempt.assistance) ?? "",
  );
  const [assistance, setAssistance] = useState<Assistance[]>([]);
  const [reproduced, setReproduced] = useState<boolean | null>(null);
  const [selectedAction, setSelectedAction] = useState<string>();
  const successfulRedo =
    attempt.type === "REDO" && (outcome === "INDEPENDENT" || outcome === "ASSISTED");
  const nextActionType = selectedAction ?? (outcome === "ASSISTED" ? "REPEAT" : "");
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
      className="outcome-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (outcome === "" || !canConfirm || (reviewed && reproduced === null)) return;
        const data = new FormData(event.currentTarget);
        const text = (name: string) => String(data.get(name) ?? "").trim() || null;
        const minutes = text("minutes");
        void onConfirm({
          ...(successfulRedo
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
        });
      }}
    >
      <fieldset disabled={busy}>
        <legend>Confirm attempt outcome</legend>
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
        <fieldset>
          <legend>Other help received (optional)</legend>
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
        </fieldset>
        {reviewed ? (
          <fieldset>
            <legend>Try the solution from memory</legend>
            <p>
              Close the reference and try coding the solution without looking. Either result keeps
              the outcome gave up.
            </p>
            <label>
              <input
                type="radio"
                name="reproduction"
                required
                checked={reproduced === true}
                onChange={() => setReproduced(true)}
              />{" "}
              I reproduced it from memory
            </label>
            <label>
              <input
                type="radio"
                name="reproduction"
                required
                checked={reproduced === false}
                onChange={() => setReproduced(false)}
              />{" "}
              I could not reproduce it
            </label>
          </fieldset>
        ) : null}
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
            Result reported. You can review the details before confirming. This attempt can no
            longer be incomplete.
          </p>
        ) : null}
        {canConfirm && successfulRedo ? (
          <fieldset>
            <legend>Next action</legend>
            {outcome === "ASSISTED" ? (
              <p>
                Repeating the problem is suggested after an assisted solve. You can choose another
                action.
              </p>
            ) : null}
            <label>
              After this redo
              <select
                required
                value={nextActionType}
                onChange={(event) => setSelectedAction(event.target.value)}
              >
                <option value="" disabled>
                  Select a next action
                </option>
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
              <select name="confidence" defaultValue="">
                <option value="">Not specified</option>
                <option value="CONFIDENT">Confident</option>
                <option value="SHAKY">Shaky</option>
              </select>
            </label>
            <label>
              Solution quality
              <select name="optimality" defaultValue="">
                <option value="">Not specified</option>
                <option value="OPTIMAL">Optimal</option>
                <option value="SUBOPTIMAL">Suboptimal</option>
                <option value="UNKNOWN">Unknown</option>
              </select>
            </label>
            <label>
              Time spent (minutes)
              <input name="minutes" type="number" min="0" max="35791394" step="0.1" />
            </label>
            <label>
              Approach (brief description, no source code)
              <textarea name="approach" maxLength={1000} rows={2} />
            </label>
            <label>
              Notes (no source code)
              <textarea name="notes" maxLength={5000} rows={3} />
            </label>
          </details>
        ) : null}
        {canConfirm ? (
          <button
            type="submit"
            disabled={busy || outcome === "" || (reviewed && reproduced === null)}
          >
            {successfulRedo ? "Confirm outcome and next action" : "Confirm outcome"}
          </button>
        ) : null}
      </fieldset>
    </form>
  );
}
