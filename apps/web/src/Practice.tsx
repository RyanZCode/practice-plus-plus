import type {
  Attempt,
  AttemptAssessmentDraft,
  CatalogProblem,
  DailyPlan,
  MemorySuggestion,
} from "@practice-plus-plus/contracts";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  loadDailyPlan,
  loadActiveAttempt,
  loadProblems,
  loadCatalogPreferences,
  saveCatalogPreferences,
  pauseTimer,
  resumeTimer,
  skipTimer,
  startAttempt,
  reviewSolution,
  confirmAttempt,
  reportAttempt,
} from "./attemptsApi";
import { AttemptOutcomeForm } from "./AttemptOutcomeForm";
import { eligibleProblems, remainingSeconds } from "./attemptState";
import { AttemptTutor } from "./AttemptTutor";
import { loadMemorySuggestions } from "./summaryApi";
import { generateAssessmentDraft, loadAssessmentDraft } from "./assessmentApi";
import { useAuth } from "./auth";

export function Practice({
  apiUrl,
  token,
  userId,
  defaultModel,
}: {
  apiUrl: string;
  token: string;
  userId: string;
  defaultModel: string;
}) {
  const { browserKey } = useAuth();
  const keyState = useSyncExternalStore(browserKey.subscribe, browserKey.getSnapshot);
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [problems, setProblems] = useState<CatalogProblem[]>([]);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [hidePaid, setHidePaid] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tutorBusy, setTutorBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [reload, setReload] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [classifying, setClassifying] = useState(false);
  const [saved, setSaved] = useState<Attempt | null>(null);
  const [memorySuggestions, setMemorySuggestions] = useState<MemorySuggestion[]>([]);
  const [assessmentDraft, setAssessmentDraft] = useState<AttemptAssessmentDraft | null>(null);
  const [assessmentLoadedFor, setAssessmentLoadedFor] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    void Promise.all([
      loadDailyPlan(apiUrl, token),
      loadProblems(apiUrl, token),
      loadActiveAttempt(apiUrl, token),
      loadCatalogPreferences(apiUrl, token),
    ])
      .then(([dailyPlan, catalog, current, preferences]) => {
        if (active) {
          setPlan(dailyPlan);
          setProblems(catalog);
          setAttempt(current);
          setHidePaid(preferences.hidePaidProblems);
        }
      })
      .catch((reason: unknown) => {
        if (active) setError(message(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [apiUrl, token, reload]);

  useEffect(() => {
    if (attempt === null) {
      setMemorySuggestions([]);
      return;
    }
    let active = true;
    void loadMemorySuggestions(apiUrl, token, attempt.id)
      .then((items) => {
        if (active) setMemorySuggestions(items);
      })
      .catch(() => {
        if (active) setMemorySuggestions([]);
      });
    return () => {
      active = false;
    };
  }, [apiUrl, token, attempt?.id, attempt?.summary]);

  useEffect(() => {
    if (attempt === null) {
      setAssessmentDraft(null);
      setAssessmentLoadedFor(null);
      return;
    }
    const attemptId = attempt.id;
    let active = true;
    setAssessmentLoadedFor(null);
    void loadAssessmentDraft(apiUrl, token, attemptId)
      .then((draft) => {
        if (active) setAssessmentDraft(draft);
      })
      .catch(() => {
        if (active) setAssessmentDraft(null);
      })
      .finally(() => {
        if (active) setAssessmentLoadedFor(attemptId);
      });
    return () => {
      active = false;
    };
  }, [apiUrl, token, attempt?.id]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function update(action: () => Promise<Attempt>) {
    setBusy(true);
    setError(undefined);
    try {
      setAttempt(await action());
      setSaved(null);
      setNow(Date.now());
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  async function changePaidFilter(value: boolean) {
    setBusy(true);
    setError(undefined);
    try {
      const preferences = await saveCatalogPreferences(apiUrl, token, value);
      setHidePaid(preferences.hidePaidProblems);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  const seconds = attempt === null ? 0 : remainingSeconds(attempt, now);
  const visible = eligibleProblems(problems, hidePaid);
  return (
    <section className="practice">
      <h2>Practice</h2>
      {saved ? (
        <div role="status">
          <p>Attempt confirmed.</p>
          {saved.patterns ? <p>Patterns: {saved.patterns.join(", ")}</p> : null}
        </div>
      ) : null}
      {loading ? <p role="status">Loading practice…</p> : null}
      {error === undefined ? null : (
        <div>
          <p className="auth-message" role="alert">
            {error}
          </p>
          <button
            type="button"
            disabled={busy || tutorBusy}
            onClick={() => setReload((value) => value + 1)}
          >
            Reload practice
          </button>
        </div>
      )}
      {!loading && attempt !== null ? (
        <div>
          <h3>{attempt.problem.title}</h3>
          {attempt.patterns ? <p>Patterns: {attempt.patterns.join(", ")}</p> : null}
          <p>
            {attempt.type === "FRESH" ? "Fresh attempt" : "Redo attempt"} · {attempt.practiceDate}
            {attempt.problem.availability === "PAID_ONLY" ? " · LeetCode Premium required" : ""}
          </p>
          <p>
            <a href={attempt.problem.url} target="_blank" rel="noreferrer">
              Open on LeetCode ↗
            </a>
          </p>
          {attempt.solutionReviewedAt !== null ? (
            <p>
              <a
                href={`https://leetcode.com/problems/${attempt.problem.slug}/solutions/`}
                target="_blank"
                rel="noreferrer"
              >
                Review LeetCode solutions ↗
              </a>
            </p>
          ) : attempt.outcome === "GAVE_UP" ? (
            <p>
              <button
                type="button"
                disabled={busy || tutorBusy}
                onClick={() => void update(() => reviewSolution(apiUrl, token, attempt.id))}
              >
                Review LeetCode solutions
              </button>
            </p>
          ) : attempt.outcome !== null ? null : seconds > 0 ? (
            <div>
              <p
                className="countdown"
                role="timer"
                aria-label="Independent practice time remaining"
              >
                {Math.floor(seconds / 60)}:{(seconds % 60).toString().padStart(2, "0")}
              </p>
              <p>
                {attempt.timerPausedAt == null
                  ? "Work independently before seeking help."
                  : "Timer paused."}
              </p>
              <div className="account-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void update(() =>
                      attempt.timerPausedAt == null
                        ? pauseTimer(apiUrl, token, attempt.id)
                        : resumeTimer(apiUrl, token, attempt.id),
                    )
                  }
                >
                  {attempt.timerPausedAt == null ? "Pause timer" : "Resume timer"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void update(() => skipTimer(apiUrl, token, attempt.id))}
                >
                  Skip timer
                </button>
              </div>
            </div>
          ) : (
            <div className="attempt-guidance" role="status">
              <h3>Next steps</h3>
              <p>You can keep working independently for as long as you need.</p>
              <p>
                If you’re stuck, try progressive AI hints, starting with the least revealing hint.
              </p>
              <p>
                Reading an editorial or solution is a less-recommended fallback after explicitly
                giving up.
              </p>
            </div>
          )}
          {attempt.outcome === null || attempt.outcome === "GAVE_UP" ? (
            <AttemptTutor
              key={attempt.id}
              apiUrl={apiUrl}
              token={token}
              userId={userId}
              defaultModel={defaultModel}
              attempt={attempt}
              hintsAvailable={seconds === 0}
              disabled={busy}
              onBusy={setTutorBusy}
              onRefresh={async () => {
                try {
                  setAttempt(await loadActiveAttempt(apiUrl, token));
                } catch {
                  setError("Reload practice to refresh recorded assistance before confirming.");
                }
              }}
            />
          ) : null}
          {attempt.solutionReviewedAt === null && attempt.outcome === null ? (
            <p>
              <button
                type="button"
                disabled={busy || tutorBusy}
                onClick={() =>
                  void update(() =>
                    reportAttempt(apiUrl, token, attempt.id, { outcome: "GAVE_UP" }),
                  )
                }
              >
                Give up and review a solution
              </button>
            </p>
          ) : null}
          {(classifying || attempt.outcome !== null) && assessmentLoadedFor !== attempt.id ? (
            <p role="status">Loading assessment draft…</p>
          ) : classifying || attempt.outcome !== null ? (
            <AttemptOutcomeForm
              key={`${attempt.id}-${attempt.solutionReviewedAt ?? "solving"}-${JSON.stringify(attempt.summary)}-${assessmentDraft?.updatedAt ?? "no-draft"}`}
              attempt={attempt}
              memorySuggestions={memorySuggestions}
              assessmentDraft={assessmentDraft}
              canDraftAssessment={keyState.hasKey}
              onDraftAssessment={async () => {
                setBusy(true);
                setError(undefined);
                try {
                  setAssessmentDraft(
                    await generateAssessmentDraft(apiUrl, token, {
                      selection: { providerId: "openai", model: defaultModel },
                      apiKey: browserKey.getKey(userId) ?? "",
                      attemptId: attempt.id,
                    }),
                  );
                } catch (reason) {
                  setError(message(reason));
                } finally {
                  setBusy(false);
                }
              }}
              busy={busy || tutorBusy}
              onReport={(input) => update(() => reportAttempt(apiUrl, token, attempt.id, input))}
              onConfirm={async (input) => {
                setBusy(true);
                setError(undefined);
                try {
                  const confirmed = await confirmAttempt(apiUrl, token, attempt.id, input);
                  setAttempt(null);
                  setClassifying(false);
                  setSaved(confirmed);
                  setReload((value) => value + 1);
                } catch (reason) {
                  setError(message(reason));
                } finally {
                  setBusy(false);
                }
              }}
            />
          ) : (
            <button type="button" disabled={busy || tutorBusy} onClick={() => setClassifying(true)}>
              Record outcome
            </button>
          )}
        </div>
      ) : null}
      {!loading && error === undefined && attempt === null ? (
        <div>
          {plan === null ? null : (
            <div className="daily-plan">
              <h3>Today’s plan · {plan.practiceDate}</h3>
              <p>
                {plan.items.filter((item) => item.status === "FINISHED").length} of{" "}
                {plan.items.length} finished · Target {plan.target}
              </p>
              <p className="settings-help">
                Today’s selections stay fixed. Settings changes apply to the next plan.
              </p>
              {plan.items.length === 0 ? (
                <p>No eligible work is available for today’s plan.</p>
              ) : (
                <ul className="problem-list">
                  {plan.items.map((item) => (
                    <li key={item.id}>
                      <div>
                        <strong>
                          {item.problem.leetcodeId}. {item.problem.title}
                        </strong>
                        <p className="settings-help">
                          {item.problem.difficulty}
                          {item.problem.availability === "PAID_ONLY"
                            ? " · LeetCode Premium required"
                            : ""}
                        </p>
                        <p className="settings-help">{item.explanation}</p>
                      </div>
                      {item.status === "FINISHED" ? (
                        <span>Finished</span>
                      ) : (
                        <button
                          type="button"
                          disabled={busy || item.problem.availability === "UNAVAILABLE"}
                          onClick={() =>
                            void update(() => startAttempt(apiUrl, token, item.problem.id))
                          }
                        >
                          {item.problem.availability === "UNAVAILABLE"
                            ? "Unavailable"
                            : item.status === "ACTIVE"
                              ? "Resume"
                              : "Start"}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <h3>Problem catalog</h3>
          <label>
            <input
              type="checkbox"
              checked={hidePaid}
              disabled={busy}
              onChange={(event) => void changePaidFilter(event.target.checked)}
            />{" "}
            Hide paid-only problems
          </label>
          {visible.length === 0 ? (
            <p>No eligible problems match this filter.</p>
          ) : (
            <ul className="problem-list">
              {visible.map((problem) => (
                <li key={problem.id}>
                  <div>
                    <strong>
                      {problem.leetcodeId}. {problem.title}
                    </strong>
                    <p className="settings-help">
                      {problem.difficulty}
                      {problem.availability === "PAID_ONLY" ? " · LeetCode Premium required" : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void update(() => startAttempt(apiUrl, token, problem.id))}
                  >
                    Start
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Unable to load practice.";
}
