import type {
  Attempt,
  AttemptAssessmentDraft,
  CatalogProblem,
  DailyPlan,
  MemorySuggestion,
} from "@practice-plus-plus/contracts";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  loadDailyPlan,
  loadSavedDailyPlan,
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
} from "../attempts/attemptsApi";
import { AttemptOutcomeForm } from "../attempts/AttemptOutcomeForm";
import { remainingSeconds } from "../attempts/attemptState";
import { AttemptTutor } from "../tutor/AttemptTutor";
import { loadMemorySuggestions } from "../learning-context/summaryApi";
import { generateAssessmentDraft, loadAssessmentDraft } from "../assessments/assessmentApi";
import { useAuth } from "../auth/auth";
import { generateIntegratedPlan } from "../planning/planningApi";
import {
  browseCatalog,
  type CatalogAvailability,
  type CatalogDifficulty,
  type CatalogSort,
  type CatalogSortDirection,
} from "./catalogBrowse";

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
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogDifficulties, setCatalogDifficulties] = useState<CatalogDifficulty[]>([]);
  const [catalogAvailabilities, setCatalogAvailabilities] = useState<CatalogAvailability[]>([]);
  const [catalogSort, setCatalogSort] = useState<CatalogSort>("LEETCODE_ID");
  const [catalogSortDirection, setCatalogSortDirection] = useState<CatalogSortDirection>("ASC");
  const catalogSortMenu = useRef<HTMLDetailsElement>(null);
  const catalogFilterMenu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function closeMenus(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) return;
      for (const menu of [catalogSortMenu.current, catalogFilterMenu.current]) {
        if (menu?.open && !menu.contains(target)) menu.open = false;
      }
    }

    function closeMenusWithKeyboard(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      if (catalogSortMenu.current) catalogSortMenu.current.open = false;
      if (catalogFilterMenu.current) catalogFilterMenu.current.open = false;
    }

    document.addEventListener("pointerdown", closeMenus);
    document.addEventListener("keydown", closeMenusWithKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeMenus);
      document.removeEventListener("keydown", closeMenusWithKeyboard);
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    void Promise.all([
      loadSavedDailyPlan(apiUrl, token),
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

  async function generatePlan(personalized: boolean) {
    setBusy(true);
    setError(undefined);
    try {
      setPlan(
        personalized
          ? await generateIntegratedPlan(
              apiUrl,
              token,
              defaultModel,
              browserKey.getKey(userId) ?? "",
            )
          : await loadDailyPlan(apiUrl, token),
      );
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  const seconds = attempt === null ? 0 : remainingSeconds(attempt, now);
  const visible = useMemo(
    () =>
      browseCatalog(problems, {
        availability: catalogAvailabilities,
        difficulty: catalogDifficulties,
        hidePaid,
        query: catalogQuery,
        sort: catalogSort,
        sortDirection: catalogSortDirection,
      }),
    [
      catalogAvailabilities,
      catalogDifficulties,
      catalogQuery,
      catalogSort,
      catalogSortDirection,
      hidePaid,
      problems,
    ],
  );
  const filterCount = catalogDifficulties.length + catalogAvailabilities.length + Number(hidePaid);

  function resetCatalogControls(): void {
    setCatalogQuery("");
    setCatalogDifficulties([]);
    setCatalogAvailabilities([]);
    setCatalogSort("LEETCODE_ID");
    setCatalogSortDirection("ASC");
    if (hidePaid) void changePaidFilter(false);
  }

  function clearCatalogFilters(): void {
    setCatalogDifficulties([]);
    setCatalogAvailabilities([]);
    if (hidePaid) void changePaidFilter(false);
  }
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
        <div className="active-attempt">
          <header className="attempt-header">
            <div>
              <p className="attempt-eyebrow">
                {attempt.type === "FRESH" ? "Fresh attempt" : "Redo attempt"} ·{" "}
                {attempt.practiceDate}
              </p>
              <h3>{attempt.problem.title}</h3>
              <p className="attempt-metadata">
                {attempt.problem.difficulty.charAt(0) +
                  attempt.problem.difficulty.slice(1).toLocaleLowerCase()}
                {attempt.patterns ? ` · ${attempt.patterns.join(", ")}` : ""}
                {attempt.problem.availability === "PAID_ONLY" ? " · LeetCode Premium required" : ""}
              </p>
            </div>
            <a
              className="attempt-problem-link"
              href={attempt.problem.url}
              target="_blank"
              rel="noreferrer"
            >
              Open on LeetCode ↗
            </a>
          </header>
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
            <section className="attempt-phase" aria-labelledby="independent-attempt-heading">
              <p className="attempt-phase-label" id="independent-attempt-heading">
                Independent attempt
              </p>
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
            </section>
          ) : (
            <section className="attempt-phase attempt-phase-complete" role="status">
              <p className="attempt-phase-label">Independent timer complete</p>
              <h4>Keep solving, or ask for the smallest useful hint</h4>
              <p>
                There is no deadline. Continue independently, or use the progressive tutor below.
                Solution review remains available only after you explicitly give up.
              </p>
            </section>
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
            <div className="attempt-completion-actions">
              <div>
                <strong>Finished working?</strong>
                <p className="settings-help">
                  Record what happened, or explicitly give up before reviewing a solution.
                </p>
              </div>
              <div className="account-actions">
                <button
                  className="primary-button"
                  type="button"
                  disabled={busy || tutorBusy}
                  onClick={() => setClassifying(true)}
                >
                  Record outcome
                </button>
                {attempt.solutionReviewedAt === null ? (
                  <button
                    className="secondary-button"
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
                ) : null}
              </div>
            </div>
          )}
        </div>
      ) : null}
      {!loading && error === undefined && attempt === null ? (
        <div>
          {plan === null ? (
            <div className="daily-plan">
              <h3>Create today’s plan</h3>
              <p className="settings-help">
                Personalization uses your bounded learning context while the server keeps review
                priorities, eligibility, and the daily target fixed. Provider failures fall back to
                the deterministic planner.
              </p>
              <div className="account-actions">
                <button
                  type="button"
                  disabled={busy || !keyState.hasKey}
                  onClick={() => void generatePlan(true)}
                >
                  {busy ? "Creating plan…" : "Personalize with AI"}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void generatePlan(false)}
                >
                  Generate without AI
                </button>
              </div>
              {!keyState.hasKey ? (
                <p className="settings-help">
                  Add an OpenAI API key in Practice settings, or use External AI from the navigation
                  and return a structured recommendation.
                </p>
              ) : null}
            </div>
          ) : (
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
          <section className="catalog-browser page-surface">
            <div className="catalog-heading">
              <div>
                <h3>Problem catalog</h3>
                <p className="settings-help">
                  Browse {problems.length} published{" "}
                  {problems.length === 1 ? "problem" : "problems"}.
                </p>
              </div>
            </div>
            <div className="catalog-toolbar">
              <label className="catalog-search">
                <span className="visually-hidden">Search problems</span>
                <input
                  type="search"
                  inputMode="search"
                  placeholder="Search number or title"
                  value={catalogQuery}
                  onChange={(event) => setCatalogQuery(event.target.value)}
                />
              </label>
              <details ref={catalogSortMenu} className="catalog-sort-menu" name="catalog-controls">
                <summary>
                  <span>Sort</span>
                  <span className="catalog-control-value">
                    {labelForSort(catalogSort)} {catalogSortDirection === "ASC" ? "↑" : "↓"}
                  </span>
                </summary>
                <div className="catalog-sort-panel">
                  <p>Sort by</p>
                  {catalogSortOptions.map((option) => (
                    <button
                      type="button"
                      className="catalog-sort-option"
                      aria-pressed={catalogSort === option.value}
                      key={option.value}
                      onClick={() => {
                        if (catalogSort === option.value) {
                          setCatalogSortDirection((direction) =>
                            direction === "ASC" ? "DESC" : "ASC",
                          );
                        } else {
                          setCatalogSort(option.value);
                          setCatalogSortDirection("ASC");
                        }
                      }}
                    >
                      <span>{option.label}</span>
                      {catalogSort === option.value ? (
                        <span aria-hidden="true">{catalogSortDirection === "ASC" ? "↑" : "↓"}</span>
                      ) : null}
                    </button>
                  ))}
                  <div className="catalog-direction-control" aria-label="Sort direction">
                    <button
                      type="button"
                      className="catalog-direction-button"
                      aria-label="Sort ascending"
                      title="Sort ascending"
                      aria-pressed={catalogSortDirection === "ASC"}
                      onClick={() => setCatalogSortDirection("ASC")}
                    >
                      <span aria-hidden="true">↑</span>
                    </button>
                    <button
                      type="button"
                      className="catalog-direction-button"
                      aria-label="Sort descending"
                      title="Sort descending"
                      aria-pressed={catalogSortDirection === "DESC"}
                      onClick={() => setCatalogSortDirection("DESC")}
                    >
                      <span aria-hidden="true">↓</span>
                    </button>
                  </div>
                </div>
              </details>
              <details
                ref={catalogFilterMenu}
                className="catalog-filter-menu"
                name="catalog-controls"
              >
                <summary>
                  Filter
                  {filterCount > 0 ? (
                    <span className="catalog-filter-count">{filterCount}</span>
                  ) : null}
                </summary>
                <div className="catalog-filter-panel">
                  <fieldset>
                    <legend>Difficulty</legend>
                    {catalogDifficultyOptions.map((option) => (
                      <label key={option.value}>
                        <input
                          type="checkbox"
                          checked={catalogDifficulties.includes(option.value)}
                          onChange={() =>
                            setCatalogDifficulties((current) => toggleValue(current, option.value))
                          }
                        />
                        {option.label}
                      </label>
                    ))}
                  </fieldset>
                  <fieldset>
                    <legend>Availability</legend>
                    {catalogAvailabilityOptions.map((option) => (
                      <label key={option.value}>
                        <input
                          type="checkbox"
                          checked={catalogAvailabilities.includes(option.value)}
                          disabled={option.value === "PAID_ONLY" && hidePaid}
                          onChange={() =>
                            setCatalogAvailabilities((current) =>
                              toggleValue(current, option.value),
                            )
                          }
                        />
                        {option.label}
                      </label>
                    ))}
                  </fieldset>
                  <fieldset>
                    <legend>Preference</legend>
                    <label>
                      <input
                        type="checkbox"
                        checked={hidePaid}
                        disabled={busy || catalogAvailabilities.includes("PAID_ONLY")}
                        onChange={(event) => void changePaidFilter(event.target.checked)}
                      />
                      Hide Premium problems
                    </label>
                    <p>Saved for future visits.</p>
                  </fieldset>
                  {filterCount > 0 ? (
                    <button
                      type="button"
                      className="catalog-clear-filters"
                      disabled={busy}
                      onClick={clearCatalogFilters}
                    >
                      Clear filters
                    </button>
                  ) : null}
                </div>
              </details>
            </div>
            {visible.length === 0 ? (
              <div className="catalog-empty">
                <p>No problems match the current search and filters.</p>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={resetCatalogControls}
                >
                  Reset controls
                </button>
              </div>
            ) : (
              <>
                <p className="catalog-result-count" role="status">
                  Showing {visible.length} of {problems.length}
                </p>
                <ul className="problem-list catalog-problem-list">
                  {visible.map((problem) => (
                    <li key={problem.id}>
                      <div className="catalog-problem-title">
                        <strong>
                          {problem.leetcodeId}. {problem.title}
                        </strong>
                      </div>
                      <span
                        className={`catalog-difficulty catalog-difficulty-${problem.difficulty.toLocaleLowerCase()}`}
                      >
                        {labelForValue(problem.difficulty)}
                      </span>
                      <span className="catalog-availability">
                        {problem.availability === "PAID_ONLY"
                          ? "Premium"
                          : problem.availability === "UNAVAILABLE"
                            ? "Unavailable"
                            : "Free"}
                      </span>
                      <button
                        type="button"
                        disabled={busy || problem.availability === "UNAVAILABLE"}
                        onClick={() => void update(() => startAttempt(apiUrl, token, problem.id))}
                      >
                        {problem.availability === "UNAVAILABLE" ? "Unavailable" : "Start"}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}

const catalogDifficultyOptions: ReadonlyArray<{
  readonly label: string;
  readonly value: CatalogDifficulty;
}> = [
  { label: "Easy", value: "EASY" },
  { label: "Medium", value: "MEDIUM" },
  { label: "Hard", value: "HARD" },
];

const catalogAvailabilityOptions: ReadonlyArray<{
  readonly label: string;
  readonly value: CatalogAvailability;
}> = [
  { label: "Free", value: "AVAILABLE" },
  { label: "Premium", value: "PAID_ONLY" },
  { label: "Unavailable", value: "UNAVAILABLE" },
];

const catalogSortOptions: ReadonlyArray<{
  readonly label: string;
  readonly value: CatalogSort;
}> = [
  { label: "Number", value: "LEETCODE_ID" },
  { label: "Title", value: "TITLE" },
  { label: "Difficulty", value: "DIFFICULTY" },
];

function toggleValue<Value>(values: readonly Value[], value: Value): Value[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function labelForValue(value: CatalogDifficulty | CatalogAvailability): string {
  return value === "PAID_ONLY" ? "Premium" : value.charAt(0) + value.slice(1).toLocaleLowerCase();
}

function labelForSort(value: CatalogSort): string {
  return catalogSortOptions.find((option) => option.value === value)?.label ?? "Number";
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Unable to load practice.";
}
