import {
  tutorHintNames,
  type Attempt,
  type DailyPlan,
  type ExternalAiExportRequest,
  type PlanningPreview,
} from "@practice-plus-plus/contracts";
import { useState, type FormEvent } from "react";
import { createExternalAiExport } from "./externalAiApi";
import { confirmExternalPlan, validateExternalPlan } from "../planning/planningApi";

type Selection =
  | "COACH"
  | "PLANNING"
  | "INDEPENDENT"
  | "CLARIFICATION"
  | "HINT_1"
  | "HINT_2"
  | "HINT_3"
  | "DEBUGGING"
  | "OPTIMIZATION"
  | "SOLUTION_REVIEW"
  | "RESULT";

export function ExternalAiExport({
  apiUrl,
  token,
  planningOnly = false,
  purpose = "GENERAL",
  attempt = null,
  resultOnly = false,
  onPlanSaved,
}: {
  apiUrl: string;
  token: string;
  planningOnly?: boolean;
  purpose?: "GENERAL" | "PLANNING";
  attempt?: Attempt | null;
  resultOnly?: boolean;
  onPlanSaved?: (plan: DailyPlan) => void;
}) {
  const [selection, setSelection] = useState<Selection>(
    planningOnly || purpose === "PLANNING"
      ? "PLANNING"
      : attempt === null
        ? "COACH"
        : resultOnly
          ? "RESULT"
          : attempt.outcome === "GAVE_UP"
            ? "SOLUTION_REVIEW"
            : attempt.outcome === null
              ? "INDEPENDENT"
              : "RESULT",
  );
  const [currentCode, setCurrentCode] = useState("");
  const [result, setResult] = useState<{ filename: string; markdown: string } | null>(null);
  const [operation, setOperation] = useState<"context" | "validation" | "confirmation" | null>(
    null,
  );
  const busy = operation !== null;
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [recommendation, setRecommendation] = useState("");
  const [preview, setPreview] = useState<PlanningPreview | null>(null);

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOperation("context");
    setPreview(null);
    setError(undefined);
    setStatus(undefined);
    try {
      setResult(
        await createExternalAiExport(
          apiUrl,
          token,
          externalAiRequest(selection, attempt, currentCode),
        ),
      );
      setStatus("Context ready. Its contents remain hidden until you copy or download it.");
    } catch (reason) {
      setResult(null);
      setError(reason instanceof Error ? reason.message : "Unable to create the export.");
    } finally {
      setOperation(null);
    }
  }

  async function copy() {
    if (result === null) return;
    try {
      await navigator.clipboard.writeText(result.markdown);
      setStatus("Context copied. Copying it does not record assistance.");
      setError(undefined);
    } catch {
      setError("The browser could not copy the context. Download it instead.");
    }
  }

  function download() {
    if (result === null) return;
    const url = URL.createObjectURL(new Blob([result.markdown], { type: "text/markdown" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = result.filename;
    link.click();
    URL.revokeObjectURL(url);
    setStatus("Context downloaded. Downloading it does not record assistance.");
  }

  async function validateRecommendation() {
    setOperation("validation");
    setError(undefined);
    try {
      const value: unknown = JSON.parse(recommendation);
      setPreview(await validateExternalPlan(apiUrl, token, value));
      setStatus("Recommendation validated. Confirm it to save today’s plan.");
    } catch (reason) {
      setPreview(null);
      setError(
        reason instanceof SyntaxError
          ? "Paste a valid JSON recommendation from your AI chat."
          : reason instanceof Error && reason.name === "ZodError"
            ? "Paste the complete version 1 recommendation from your AI chat."
            : reason instanceof Error
              ? reason.message
              : "The recommendation is invalid.",
      );
    } finally {
      setOperation(null);
    }
  }

  async function confirmRecommendation() {
    if (preview === null) return;
    setOperation("confirmation");
    setError(undefined);
    try {
      const plan = await confirmExternalPlan(apiUrl, token, preview.recommendation);
      setPreview(null);
      setRecommendation("");
      setStatus("Today’s plan was saved. Open Today to begin.");
      onPlanSaved?.(plan);
    } catch (reason) {
      setPreview(null);
      setError(reason instanceof Error ? reason.message : "The recommendation could not be saved.");
    } finally {
      setOperation(null);
    }
  }

  const choices =
    planningOnly || purpose === "PLANNING"
      ? ([["PLANNING", "Practice planning"]] as [Selection, string][])
      : resultOnly
        ? ([["RESULT", "Record the result"]] as [Selection, string][])
        : externalAiSelections(attempt);
  return (
    <section className="external-ai">
      <h3>{selection === "PLANNING" ? "Plan with my AI chat" : "Use my AI chat"}</h3>
      <p className="settings-help">
        {selection === "PLANNING"
          ? "Copy your planning context into your AI chat, then return its plan recommendation here."
          : "Continue your existing AI conversation, or start a new one with updated context."}
      </p>
      <p className="settings-help">
        Includes relevant goals, preferences, approved memories, confirmed evidence, and current
        workflow context. Hidden patterns may appear in a marked final section. The contents stay
        hidden here. Your external service controls its chat retention.
      </p>
      <form className="settings-form" onSubmit={(event) => void generate(event)}>
        <label hidden={choices.length < 2}>
          Conversation stage
          <select
            value={selection}
            disabled={busy}
            onChange={(event) => {
              setSelection(event.target.value as Selection);
              setResult(null);
              setCurrentCode("");
              setStatus(undefined);
              setError(undefined);
            }}
          >
            {choices.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {selection === "DEBUGGING" ? (
          <label>
            Current code (optional)
            <span className="settings-help">
              Included only in this response. Practice++ does not save it.
            </span>
            <textarea
              rows={8}
              maxLength={16000}
              value={currentCode}
              disabled={busy}
              onChange={(event) => setCurrentCode(event.target.value)}
            />
          </label>
        ) : null}
        {error ? (
          <p className="auth-message" role="alert">
            {error}
          </p>
        ) : null}
        {status ? (
          <p className="save-message" role="status">
            {status}
          </p>
        ) : null}
        <div className="account-actions">
          <button type="submit" disabled={busy} className="primary-button">
            {operation === "context" ? "Creating…" : "Create context"}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={result === null || busy}
            onClick={() => void copy()}
          >
            Copy context
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={result === null || busy}
            onClick={download}
          >
            Download Markdown
          </button>
        </div>
      </form>
      {selection === "PLANNING" && result !== null ? (
        <section className="external-recommendation" aria-label="External planning recommendation">
          <h3>Return a recommendation</h3>
          <p className="settings-help">
            Paste the AI’s version 1 JSON response. Validation does not change today’s plan.
          </p>
          <label>
            Recommendation JSON
            <textarea
              rows={7}
              value={recommendation}
              disabled={busy}
              onChange={(event) => {
                setRecommendation(event.target.value);
                setPreview(null);
              }}
            />
          </label>
          <button
            type="button"
            disabled={busy || recommendation.trim() === ""}
            onClick={() => void validateRecommendation()}
          >
            {operation === "validation" ? "Validating…" : "Validate recommendation"}
          </button>
          {preview ? (
            <div className="daily-plan">
              <h3>Proposed fresh choices</h3>
              <ol>
                {preview.problems.map((problem) => (
                  <li key={problem.id}>
                    {problem.leetcodeId}. {problem.title} ({problem.difficulty})
                  </li>
                ))}
              </ol>
              <p className="settings-help">
                Reviews, transfers, capacity, and the diagnostic slot are applied by Practice++ when
                you confirm.
              </p>
              <button type="button" disabled={busy} onClick={() => void confirmRecommendation()}>
                {operation === "confirmation" ? "Saving plan…" : "Confirm and save plan"}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
      {selection === "RESULT" ? (
        <p className="settings-help">
          Return to the result form to review the outcome and report actual assistance before
          confirming. External transcripts and assessments are not imported.
        </p>
      ) : attempt !== null ? (
        <p className="settings-help">
          Copying context does not record help. Report any help you use when recording your result.
        </p>
      ) : null}
    </section>
  );
}

export function externalAiSelections(attempt: Attempt | null): [Selection, string][] {
  if (attempt === null) return [["COACH", "General coaching"]];
  if (attempt.outcome === null)
    return [
      ["INDEPENDENT", "Independent work"],
      ["CLARIFICATION", "Clarify the problem"],
      ["HINT_1", tutorHintNames[0]],
      ["HINT_2", tutorHintNames[1]],
      ["HINT_3", tutorHintNames[2]],
      ["DEBUGGING", "Debug current code"],
      ["OPTIMIZATION", "Complexity and optimization"],
    ];
  const values: [Selection, string][] = [];
  if (attempt.outcome === "GAVE_UP") values.push(["SOLUTION_REVIEW", "Solution review"]);
  values.push(["RESULT", "Record the result"]);
  return values;
}

export function externalAiRequest(
  selection: Selection,
  attempt: Attempt | null,
  currentCode: string,
): ExternalAiExportRequest {
  if (selection === "COACH") return { policy: { mode: "COACH", purpose: "GENERAL" } };
  if (selection === "PLANNING") return { policy: { mode: "COACH", purpose: "PLANNING" } };
  if (attempt === null)
    throw new Error("Start or resume an attempt before creating tutor context.");
  if (selection === "INDEPENDENT")
    return { policy: { mode: "ATTEMPT_TUTOR", attemptId: attempt.id, phase: "INDEPENDENT" } };
  if (selection === "SOLUTION_REVIEW")
    return { policy: { mode: "ATTEMPT_TUTOR", attemptId: attempt.id, phase: "SOLUTION_REVIEW" } };
  if (selection === "RESULT")
    return { policy: { mode: "ATTEMPT_TUTOR", attemptId: attempt.id, phase: "RESULT" } };
  const hintLevel = selection.startsWith("HINT_") ? Number(selection.at(-1)) : undefined;
  const help = hintLevel === undefined ? selection : "CONCEPTUAL_HINT";
  return {
    policy: {
      mode: "ATTEMPT_TUTOR",
      attemptId: attempt.id,
      phase: "HELP",
      help,
      ...(hintLevel === undefined ? {} : { hintLevel }),
    },
    ...(selection === "DEBUGGING" && currentCode.trim() ? { currentCode } : {}),
  } as ExternalAiExportRequest;
}
