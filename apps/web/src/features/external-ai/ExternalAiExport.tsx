import {
  tutorHintNames,
  type Attempt,
  type ExternalAiExportRequest,
} from "@practice-plus-plus/contracts";
import { useEffect, useState, type FormEvent } from "react";
import { loadActiveAttempt } from "../attempts/attemptsApi";
import { createExternalAiExport } from "./externalAiApi";
import type { PlanningPreview } from "@practice-plus-plus/contracts";
import { confirmExternalPlan, validateExternalPlan } from "../planning/planningApi";

type Selection =
  | "COACH"
  | "PLANNING"
  | "INDEPENDENT"
  | "CLARIFICATION"
  | "HINT_1"
  | "HINT_2"
  | "HINT_3"
  | "HINT_4"
  | "DEBUGGING"
  | "OPTIMIZATION"
  | "SOLUTION_REVIEW"
  | "RESULT";

export function ExternalAiExport({ apiUrl, token }: { apiUrl: string; token: string }) {
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [selection, setSelection] = useState<Selection>("PLANNING");
  const [currentCode, setCurrentCode] = useState("");
  const [result, setResult] = useState<{ filename: string; markdown: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [recommendation, setRecommendation] = useState("");
  const [preview, setPreview] = useState<PlanningPreview | null>(null);

  useEffect(() => {
    let active = true;
    void loadActiveAttempt(apiUrl, token)
      .then((value) => {
        if (active) setAttempt(value);
      })
      .catch(() => {
        if (active)
          setError("Unable to check the active attempt. Coaching exports remain available.");
      });
    return () => {
      active = false;
    };
  }, [apiUrl, token]);

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    setStatus(undefined);
    try {
      setResult(
        await createExternalAiExport(apiUrl, token, requestFor(selection, attempt, currentCode)),
      );
      setStatus("Context ready. Its contents remain hidden until you copy or download it.");
    } catch (reason) {
      setResult(null);
      setError(reason instanceof Error ? reason.message : "Unable to create the export.");
    } finally {
      setBusy(false);
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
    setBusy(true);
    setError(undefined);
    try {
      const value: unknown = JSON.parse(recommendation);
      setPreview(await validateExternalPlan(apiUrl, token, value));
      setStatus("Recommendation validated. Confirm it to save today’s plan.");
    } catch (reason) {
      setPreview(null);
      setError(reason instanceof Error ? reason.message : "The recommendation is invalid.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmRecommendation() {
    if (preview === null) return;
    setBusy(true);
    setError(undefined);
    try {
      await confirmExternalPlan(apiUrl, token, preview.recommendation);
      setPreview(null);
      setRecommendation("");
      setStatus("Today’s plan was saved. Open Practice to begin.");
    } catch (reason) {
      setPreview(null);
      setError(reason instanceof Error ? reason.message : "The recommendation could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const choices = selections(attempt);
  return (
    <section className="external-ai page-surface">
      <h2>External AI context</h2>
      <p className="settings-help">
        Create a bounded Markdown package for an AI conversation outside Practice++. It can include
        hidden pattern tags, but the package is never displayed on this page.
      </p>
      <form className="settings-form" onSubmit={(event) => void generate(event)}>
        <label>
          Conversation stage
          <select
            value={selection}
            disabled={busy}
            onChange={(event) => {
              setSelection(event.target.value as Selection);
              setResult(null);
              setCurrentCode("");
              setStatus(undefined);
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
        <p className="settings-help">
          Copying or downloading context is not assistance. Report any help you actually receive
          when you record the attempt.
        </p>
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
          <button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create context"}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={result === null || busy}
            onClick={() => void copy()}
          >
            Copy
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
        <section aria-label="External planning recommendation">
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
            Validate recommendation
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
                Confirm and save plan
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}

function selections(attempt: Attempt | null): [Selection, string][] {
  const values: [Selection, string][] = [
    ["PLANNING", "Practice planning"],
    ["COACH", "General coaching"],
  ];
  if (attempt === null) return values;
  if (attempt.outcome === null)
    return values.concat([
      ["INDEPENDENT", "Independent work"],
      ["CLARIFICATION", "Clarify the problem"],
      ["HINT_1", tutorHintNames[0]],
      ["HINT_2", tutorHintNames[1]],
      ["HINT_3", tutorHintNames[2]],
      ["HINT_4", tutorHintNames[3]],
      ["DEBUGGING", "Debug current code"],
      ["OPTIMIZATION", "Complexity and optimization"],
    ]);
  if (attempt.outcome === "GAVE_UP") values.push(["SOLUTION_REVIEW", "Solution review"]);
  values.push(["RESULT", "Record the result"]);
  return values;
}

function requestFor(
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
