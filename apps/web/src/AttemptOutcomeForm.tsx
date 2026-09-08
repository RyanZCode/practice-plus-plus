import {
  suggestedOutcome,
  type Assistance,
  type Attempt,
  type ConfirmAttempt,
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
}: {
  attempt: Attempt;
  busy: boolean;
  onConfirm: (input: ConfirmAttempt) => Promise<void>;
}) {
  const [outcome, setOutcome] = useState<ConfirmAttempt["outcome"] | "">(
    attempt.outcome ?? suggestedOutcome(attempt.assistance) ?? "",
  );
  const [assistance, setAssistance] = useState<Assistance[]>([]);
  const [reproduced, setReproduced] = useState<boolean | null>(null);
  const required = suggestedOutcome([...attempt.assistance, ...assistance]);
  const reviewed = required === "GAVE_UP";

  function toggleHelp(type: Assistance["type"], checked: boolean) {
    const next = checked
      ? [...assistance, { type, hintLevel: null }]
      : assistance.filter((event) => event.type !== type);
    setAssistance(next);
    const suggestion = suggestedOutcome([...attempt.assistance, ...next]);
    if (suggestion !== null) setOutcome(suggestion);
    if (type === "SOLUTION_REVIEW") setReproduced(null);
  }

  return (
    <form
      className="outcome-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (outcome === "" || (reviewed && reproduced === null)) return;
        const data = new FormData(event.currentTarget);
        const text = (name: string) => String(data.get(name) ?? "").trim() || null;
        const minutes = text("minutes");
        void onConfirm({
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
            <option value="INDEPENDENT" disabled={required !== null}>
              Independent — solved without substantive help
            </option>
            <option value="ASSISTED" disabled={reviewed}>
              Assisted — solved with help
            </option>
            <option value="GAVE_UP">Gave up</option>
            <option value="INCOMPLETE" disabled={reviewed}>
              Incomplete — stopped without a result
            </option>
          </select>
        </label>
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
        <button
          type="submit"
          disabled={busy || outcome === "" || (reviewed && reproduced === null)}
        >
          Confirm outcome
        </button>
      </fieldset>
    </form>
  );
}
