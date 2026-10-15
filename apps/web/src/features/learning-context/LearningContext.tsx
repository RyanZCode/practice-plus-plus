import {
  type LearnerGoal,
  type LearningContextInference,
  type LearningContextResponse,
  type TeachingPreference,
} from "@practice-plus-plus/contracts";
import { useEffect, useRef, useState, type FormEvent } from "react";
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
  const [section, setSection] = useState("goals");
  const [saved, setSaved] = useState(false);
  const tabs = useRef<HTMLElement>(null);

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
    setSection("suggestions");
    const frame = window.requestAnimationFrame(() => {
      tabs.current?.querySelector<HTMLButtonElement>('[data-section="suggestions"]')?.focus();
      onFocusHandled();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [context, focusInferences, onFocusHandled]);

  async function change(action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setSaved(false);
    setError(undefined);
    try {
      await action();
      setReload((value) => value + 1);
      setSaved(true);
      return true;
    } catch (changeError) {
      setError(message(changeError));
      return false;
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
          <h2>Learning profile</h2>
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
      {busy || saved ? (
        <p className="learning-save-status" role="status">
          {busy ? "Saving changes…" : "Changes saved."}
        </p>
      ) : null}
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
          <nav
            ref={tabs}
            className="learning-tabs"
            aria-label="Learning profile sections"
            role="tablist"
            onKeyDown={(event) => {
              const buttons = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
              ];
              const index = buttons.indexOf(event.target as HTMLButtonElement);
              if (index < 0 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
                return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? buttons.length - 1
                    : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) %
                      buttons.length;
              setSection(buttons[next]!.dataset.section!);
              buttons[next]!.focus();
            }}
          >
            {[
              ["goals", "Goals & preferences", "memory-supplied"],
              ["evidence", "Observed evidence", "memory-evidence"],
              ["suggestions", "Suggestions", "memory-inferences"],
            ].map(([key, title, panel]) => (
              <button
                key={key}
                id={`learning-tab-${key}`}
                type="button"
                role="tab"
                data-section={key}
                aria-selected={section === key}
                aria-controls={panel}
                tabIndex={section === key ? 0 : -1}
                className="secondary-button"
                onClick={() => setSection(key!)}
              >
                {title}
              </button>
            ))}
          </nav>
          <section
            className="context-section"
            id="memory-supplied"
            role="tabpanel"
            tabIndex={0}
            aria-labelledby="learning-tab-goals"
            hidden={section !== "goals"}
          >
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
                        : Promise.resolve(false)
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
                        : Promise.resolve(false)
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

          <section
            className="context-section"
            id="memory-evidence"
            role="tabpanel"
            tabIndex={0}
            aria-labelledby="learning-tab-evidence"
            hidden={section !== "evidence"}
          >
            <h3>Confirmed practice and checkpoints</h3>
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
                  <small>Source: confirmed attempt</small>
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
                  <small>
                    Source: compact {label(summary.mode).toLowerCase()} summary, without transcripts
                    or code
                  </small>
                </li>
              ))}
            </ul>
          </section>

          <section
            className="context-section"
            id="memory-inferences"
            role="tabpanel"
            tabIndex={0}
            aria-labelledby="learning-tab-suggestions"
            hidden={section !== "suggestions"}
          >
            <h3>Suggestions to review</h3>
            <p className="settings-help">
              Only approved inferences can be used in later AI context. Pending and rejected items
              stay excluded.
            </p>
            {context.inferred.length === 0 ? <p>No inferences yet.</p> : null}
            {(["PENDING", "REVIEWED"] as const).map((group) => (
              <div key={group} className="inference-group">
                <h4>{group === "PENDING" ? "To review" : "Reviewed memories"}</h4>
                <ul className="context-list inference-list">
                  {context.inferred
                    .filter((inference) =>
                      group === "PENDING"
                        ? inference.approvalState === "PENDING"
                        : inference.approvalState !== "PENDING",
                    )
                    .map((inference) => (
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
                              : Promise.resolve(false)
                          }
                        />
                      </li>
                    ))}
                </ul>
              </div>
            ))}
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
  readonly onSave: (input: Omit<LearnerGoal, "id">) => Promise<boolean>;
  readonly onRemove?: () => Promise<boolean>;
}) {
  const [target, setTarget] = useState(goal?.target ?? "");
  const [priority, setPriority] = useState(String(goal?.priority ?? 0));
  const [state, setState] = useState<LearnerGoal["state"]>(goal?.state ?? "ACTIVE");
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const saved = await onSave({ target, priority: Number(priority), state });
    if (saved && goal === undefined) setTarget("");
  }
  return (
    <details className="context-row">
      <summary>
        {goal === undefined ? (
          "Add goal"
        ) : (
          <>
            <span>
              <strong>{goal.target}</strong>
              <small>You supplied this · Priority {goal.priority}</small>
            </span>
            <span className="context-state">{label(goal.state)}</span>
          </>
        )}
      </summary>
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
        <p className="settings-help">
          Changes can return memories that depend on this goal to pending review.
        </p>
      </form>
    </details>
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
  readonly onSave: (input: { preference: string }) => Promise<boolean>;
  readonly onRemove?: () => Promise<boolean>;
}) {
  const [value, setValue] = useState(preference?.preference ?? "");
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const saved = await onSave({ preference: value });
    if (saved && preference === undefined) setValue("");
  }
  return (
    <details className="context-row">
      <summary>
        {preference === undefined ? (
          "Add preference"
        ) : (
          <span>
            <strong>{preference.preference}</strong>
            <small>You supplied this</small>
          </span>
        )}
      </summary>
      <form
        className="compact-context-form preference-form"
        onSubmit={(event) => void submit(event)}
      >
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
        <p className="settings-help">Changes can return dependent memories to pending review.</p>
      </form>
    </details>
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
  readonly onReview: (review: Parameters<typeof reviewInference>[3]) => Promise<boolean>;
  readonly onRemove: () => Promise<boolean>;
}) {
  const [category, setCategory] = useState(inference.category);
  const [content, setContent] = useState(inference.content);
  const [confidence, setConfidence] = useState(String(inference.confidence));
  const [lifecycleState, setLifecycleState] = useState(inference.lifecycleState);
  return (
    <details className="context-row inference-row">
      <summary>
        <span>
          <strong>{inference.content}</strong>
          <small>
            {inference.approvalState === "APPROVED"
              ? "Available for future context"
              : "Excluded from future context"}
          </small>
        </span>
        <span className="context-state">{label(inference.approvalState)}</span>
      </summary>
      <div className="inference-review">
        <div className="inference-meta">
          <span>{inference.category}</span>
          <span>{label(inference.lifecycleState)}</span>
          <span>{Math.round(inference.confidence * 100)}% confidence</span>
          <span>Last observed {date(inference.lastObservedAt)}</span>
        </div>
        <details className="inference-evidence">
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
        <details className="inference-correction">
          <summary>Correct memory</summary>
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
                    setLifecycleState(
                      event.target.value as LearningContextInference["lifecycleState"],
                    )
                  }
                >
                  <option value="ACTIVE">Active</option>
                  <option value="IMPROVING">Improving</option>
                  <option value="RESOLVED">Resolved</option>
                </select>
              </label>
            </div>
            <div className="context-actions">
              <button type="submit" disabled={busy}>
                Save correction
              </button>
            </div>
            <p className="settings-help">
              Saving a correction keeps this memory's {label(inference.approvalState).toLowerCase()}{" "}
              approval status. Historical attempts are unchanged.
            </p>
          </form>
        </details>
        <div className="context-actions">
          {inference.approvalState === "APPROVED" ? null : (
            <button
              className="secondary-button"
              type="button"
              disabled={busy || inference.evidence.length === 0}
              onClick={() => void onReview({ action: "APPROVE" })}
            >
              Approve memory
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
      </div>
    </details>
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
  if (error instanceof Error && error.name === "ZodError")
    return "Check the fields and use plain learning notes without code excerpts.";
  return error instanceof Error ? error.message : "Something went wrong.";
}
