import {
  type LearnerGoal,
  type LearningContextInference,
  type LearningContextResponse,
  type TeachingPreference,
} from "@practice-plus-plus/contracts";
import { useEffect, useState, type FormEvent } from "react";
import {
  createGoal,
  createTeachingPreference,
  learningContextExport,
  loadLearningContext,
  removeGoal,
  removeInference,
  removeTeachingPreference,
  reviewInference,
  updateGoal,
  updateTeachingPreference,
} from "./learningContextApi";

interface LearningContextProps {
  readonly apiUrl: string;
  readonly focusInferences: boolean;
  readonly onFocusHandled: () => void;
  readonly token: string;
}

export function LearningContext({
  apiUrl,
  focusInferences,
  onFocusHandled,
  token,
}: LearningContextProps) {
  const [context, setContext] = useState<LearningContextResponse>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setError(undefined);
    void loadLearningContext(apiUrl, token)
      .then((loaded) => {
        if (active) setContext(loaded);
      })
      .catch((loadError: unknown) => {
        if (active) setError(message(loadError));
      });
    return () => {
      active = false;
    };
  }, [apiUrl, reload, token]);

  useEffect(() => {
    if (!focusInferences || context === undefined) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById("memory-inferences")?.scrollIntoView({ block: "start" });
      onFocusHandled();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [context, focusInferences, onFocusHandled]);

  async function change(action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      setReload((value) => value + 1);
    } catch (changeError) {
      setError(message(changeError));
    } finally {
      setBusy(false);
    }
  }

  function download(): void {
    if (context === undefined) return;
    const blob = new Blob([learningContextExport(context)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = "practice-plus-plus-learning-context.json";
    link.click();
    URL.revokeObjectURL(href);
  }

  if (context === undefined && error === undefined)
    return <p className="settings-status">Loading learning context…</p>;

  return (
    <section className="learning-context page-surface">
      <div className="learning-context-heading">
        <div>
          <h2>What Practice++ knows about me</h2>
          <p className="settings-help">
            Review what you supplied, what your practice history shows, and what Practice++
            inferred.
          </p>
        </div>
        <button
          className="secondary-button"
          type="button"
          disabled={context === undefined}
          onClick={download}
        >
          Export JSON
        </button>
      </div>
      {error === undefined ? null : (
        <p className="auth-message" role="alert">
          {error}
        </p>
      )}
      {context === undefined ? (
        <button
          className="secondary-button"
          type="button"
          onClick={() => setReload((value) => value + 1)}
        >
          Try again
        </button>
      ) : (
        <>
          <nav className="section-navigation" aria-label="Memory sections">
            <a href="#memory-supplied">Supplied</a>
            <a href="#memory-evidence">Evidence</a>
            <a href="#memory-inferences">Inferences</a>
          </nav>
          <section className="context-section" id="memory-supplied">
            <h3>Information you supplied</h3>
            <h4>Goals</h4>
            {context.userSupplied.goals.length === 0 ? <p>No goals saved yet.</p> : null}
            <ul className="context-list">
              {context.userSupplied.goals.map((goal) => (
                <li key={goal.id}>
                  <GoalForm
                    goal={goal}
                    busy={busy}
                    onSave={(input) => change(() => updateGoal(apiUrl, token, goal.id, input))}
                    onRemove={() =>
                      window.confirm(
                        "Remove this goal? Inferences that rely on it may return to pending.",
                      )
                        ? change(() => removeGoal(apiUrl, token, goal.id))
                        : Promise.resolve()
                    }
                  />
                </li>
              ))}
            </ul>
            <GoalForm
              busy={busy}
              onSave={(input) => change(() => createGoal(apiUrl, token, input))}
            />
            <h4>Teaching preferences</h4>
            {context.userSupplied.teachingPreferences.length === 0 ? (
              <p>No teaching preferences saved yet.</p>
            ) : null}
            <ul className="context-list">
              {context.userSupplied.teachingPreferences.map((preference) => (
                <li key={preference.id}>
                  <PreferenceForm
                    preference={preference}
                    busy={busy}
                    onSave={(input) =>
                      change(() => updateTeachingPreference(apiUrl, token, preference.id, input))
                    }
                    onRemove={() =>
                      window.confirm(
                        "Remove this preference? Inferences that rely on it may return to pending.",
                      )
                        ? change(() => removeTeachingPreference(apiUrl, token, preference.id))
                        : Promise.resolve()
                    }
                  />
                </li>
              ))}
            </ul>
            <PreferenceForm
              busy={busy}
              onSave={(input) => change(() => createTeachingPreference(apiUrl, token, input))}
            />
          </section>

          <section className="context-section" id="memory-evidence">
            <h3>Evidence Practice++ observed</h3>
            <p className="settings-help">
              Historical facts remain tied to their source records. Changing an inference does not
              rewrite an attempt.
            </p>
            {context.observed.attempts.length === 0 && context.observed.summaries.length === 0 ? (
              <p>No confirmed practice evidence yet.</p>
            ) : null}
            <ul className="context-list observed-list">
              {context.observed.attempts.map((attempt) => (
                <li key={attempt.id}>
                  <strong>{attempt.problemTitle}</strong>
                  <span>
                    {label(attempt.outcome)} on {attempt.practiceDate}
                  </span>
                  {attempt.assistance.length === 0 ? null : (
                    <small>
                      Assistance: {attempt.assistance.map((item) => label(item)).join(", ")}
                    </small>
                  )}
                </li>
              ))}
              {context.observed.summaries.map((summary) => (
                <li key={summary.id}>
                  <strong>{label(summary.mode)} summary</strong>
                  <span>{summary.topics}</span>
                  <small>Updated {date(summary.updatedAt)}</small>
                </li>
              ))}
            </ul>
          </section>

          <section className="context-section" id="memory-inferences">
            <h3>Conclusions Practice++ inferred</h3>
            <p className="settings-help">
              Only approved inferences can be used in later AI context. Pending and rejected items
              stay excluded.
            </p>
            {context.inferred.length === 0 ? <p>No inferences yet.</p> : null}
            <ul className="context-list inference-list">
              {context.inferred.map((inference) => (
                <li key={inference.id}>
                  <InferenceForm
                    inference={inference}
                    busy={busy}
                    onReview={(review) =>
                      change(() => reviewInference(apiUrl, token, inference.id, review))
                    }
                    onRemove={() =>
                      window.confirm("Permanently remove this inference?")
                        ? change(() => removeInference(apiUrl, token, inference.id))
                        : Promise.resolve()
                    }
                  />
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </section>
  );
}

function GoalForm({
  goal,
  busy,
  onSave,
  onRemove,
}: {
  readonly goal?: LearnerGoal;
  readonly busy: boolean;
  readonly onSave: (input: Omit<LearnerGoal, "id">) => Promise<void>;
  readonly onRemove?: () => Promise<void>;
}) {
  const [target, setTarget] = useState(goal?.target ?? "");
  const [priority, setPriority] = useState(String(goal?.priority ?? 0));
  const [state, setState] = useState<LearnerGoal["state"]>(goal?.state ?? "ACTIVE");
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    await onSave({ target, priority: Number(priority), state });
    if (goal === undefined) setTarget("");
  }
  return (
    <form className="compact-context-form" onSubmit={(event) => void submit(event)}>
      <label>
        Goal
        <input
          value={target}
          maxLength={1000}
          required
          onChange={(event) => setTarget(event.target.value)}
        />
      </label>
      <label>
        Priority
        <input
          type="number"
          min="0"
          step="1"
          value={priority}
          onChange={(event) => setPriority(event.target.value)}
        />
      </label>
      <label>
        Status
        <select
          value={state}
          onChange={(event) => setState(event.target.value as LearnerGoal["state"])}
        >
          <option value="ACTIVE">Active</option>
          <option value="COMPLETED">Completed</option>
          <option value="ARCHIVED">Archived</option>
        </select>
      </label>
      <div className="context-actions">
        <button type="submit" disabled={busy}>
          {goal === undefined ? "Add goal" : "Save goal"}
        </button>
        {onRemove === undefined ? null : (
          <button
            className="danger-button"
            type="button"
            disabled={busy}
            onClick={() => void onRemove()}
          >
            Remove
          </button>
        )}
      </div>
    </form>
  );
}

function PreferenceForm({
  preference,
  busy,
  onSave,
  onRemove,
}: {
  readonly preference?: TeachingPreference;
  readonly busy: boolean;
  readonly onSave: (input: { preference: string }) => Promise<void>;
  readonly onRemove?: () => Promise<void>;
}) {
  const [value, setValue] = useState(preference?.preference ?? "");
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    await onSave({ preference: value });
    if (preference === undefined) setValue("");
  }
  return (
    <form className="compact-context-form preference-form" onSubmit={(event) => void submit(event)}>
      <label>
        Preference
        <input
          value={value}
          maxLength={1000}
          required
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <div className="context-actions">
        <button type="submit" disabled={busy}>
          {preference === undefined ? "Add preference" : "Save preference"}
        </button>
        {onRemove === undefined ? null : (
          <button
            className="danger-button"
            type="button"
            disabled={busy}
            onClick={() => void onRemove()}
          >
            Remove
          </button>
        )}
      </div>
    </form>
  );
}

function InferenceForm({
  inference,
  busy,
  onReview,
  onRemove,
}: {
  readonly inference: LearningContextInference;
  readonly busy: boolean;
  readonly onReview: (review: Parameters<typeof reviewInference>[3]) => Promise<void>;
  readonly onRemove: () => Promise<void>;
}) {
  const [category, setCategory] = useState(inference.category);
  const [content, setContent] = useState(inference.content);
  const [confidence, setConfidence] = useState(String(inference.confidence));
  const [lifecycleState, setLifecycleState] = useState(inference.lifecycleState);
  return (
    <form
      className="inference-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onReview({
          action: "CORRECT",
          correction: { category, content, confidence: Number(confidence), lifecycleState },
        });
      }}
    >
      <div className="inference-meta">
        <span>{label(inference.approvalState)}</span>
        <span>{label(inference.lifecycleState)}</span>
        <span>{Math.round(inference.confidence * 100)}% confidence</span>
        <span>Last observed {date(inference.lastObservedAt)}</span>
      </div>
      <label>
        Category
        <input
          value={category}
          maxLength={100}
          required
          onChange={(event) => setCategory(event.target.value)}
        />
      </label>
      <label>
        Inference
        <textarea
          value={content}
          maxLength={1000}
          required
          rows={3}
          onChange={(event) => setContent(event.target.value)}
        />
      </label>
      <div className="inference-fields">
        <label>
          Confidence
          <input
            type="number"
            min="0"
            max="1"
            step="0.05"
            value={confidence}
            onChange={(event) => setConfidence(event.target.value)}
          />
        </label>
        <label>
          Lifecycle
          <select
            value={lifecycleState}
            onChange={(event) =>
              setLifecycleState(event.target.value as LearningContextInference["lifecycleState"])
            }
          >
            <option value="ACTIVE">Active</option>
            <option value="IMPROVING">Improving</option>
            <option value="RESOLVED">Resolved</option>
          </select>
        </label>
      </div>
      <details>
        <summary>Supporting evidence ({inference.evidence.length})</summary>
        {inference.evidence.length === 0 ? (
          <p>This source evidence was removed. The inference cannot be approved.</p>
        ) : (
          <ul>
            {inference.evidence.map((evidence, index) => (
              <li key={`${evidence.type}-${evidence.id}-${index}`}>
                <strong>{label(evidence.type)}</strong>: {evidence.label}
                {"occurredAt" in evidence ? ` (${date(evidence.occurredAt)})` : ""}
              </li>
            ))}
          </ul>
        )}
      </details>
      <div className="context-actions">
        <button type="submit" disabled={busy}>
          Save correction
        </button>
        {inference.approvalState === "APPROVED" ? null : (
          <button
            className="secondary-button"
            type="button"
            disabled={busy || inference.evidence.length === 0}
            onClick={() => void onReview({ action: "APPROVE" })}
          >
            Approve
          </button>
        )}
        {inference.approvalState === "REJECTED" ? null : (
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={() => void onReview({ action: "REJECT" })}
          >
            Reject
          </button>
        )}
        <button
          className="danger-button"
          type="button"
          disabled={busy}
          onClick={() => void onRemove()}
        >
          Remove
        </button>
      </div>
    </form>
  );
}

function label(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function date(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
