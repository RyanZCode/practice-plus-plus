import type {
  Attempt,
  AttemptAssessmentDraft,
  CatalogListProblem,
  CatalogProgress,
  DailyPlan,
  MemorySuggestion,
  ReasoningEffort,
  PracticeSettings,
} from "@practice-plus-plus/contracts";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  loadDailyPlan,
  loadSavedDailyPlan,
  loadActiveAttempt,
  loadProblems,
  pauseTimer,
  resumeTimer,
  skipTimer,
  cancelAttempt as cancelActiveAttempt,
  startAttempt,
  startExtraPractice,
  reviewSolution,
  confirmAttempt,
  reportAttempt,
} from "../attempts/attemptsApi";
import { AttemptWorkspace } from "../attempts/AttemptWorkspace";
import { ReviewDateForm } from "../attempts/ReviewDateForm";
import { AttemptOutcomeForm } from "../attempts/AttemptOutcomeForm";
import {
  attemptDocumentTitle,
  formatRemainingSeconds,
  remainingSeconds,
} from "../attempts/attemptState";
import { AttemptTutor } from "../tutor/AttemptTutor";
import { recentCoachMessages } from "../coach/coachApi";
import { loadTutorConversation } from "../tutor/tutorConversationStorage";
import { loadMemorySuggestions } from "../learning-context/summaryApi";
import { generateAssessmentDraft, loadAssessmentDraft } from "../assessments/assessmentApi";
import { useAuth } from "../auth/auth";
import { useModelDiscovery } from "../settings/ModelDiscovery";
import { generateExtraPracticeWithAi, generateIntegratedPlan } from "../planning/planningApi";
import {
  type CatalogAvailability,
  type CatalogDifficulty,
  type CatalogSort,
  type CatalogSortDirection,
} from "./catalogBrowse";
import { CatalogProblemDetails } from "./CatalogProblemDetails";
import { Today } from "./Today";
import { ExternalAiExport } from "../external-ai/ExternalAiExport";
import { openAiSelection } from "../../shared/aiSelection";
import "./practice.css";

export function Practice({
  apiUrl,
  token,
  userId,
  defaultModel,
  defaultReasoningEffort,
  view,
  settings,
  onNavigate,
  onAiSetup,
  refresh,
}: {
  view: "today" | "problems";
  settings: PracticeSettings;
  refresh: number;
  onNavigate: (view: "practice" | "problems" | "settings" | "learning") => void;
  onAiSetup: (workflow: "attempt" | "today") => void;
  apiUrl: string;
  token: string;
  userId: string;
  defaultModel: string;
  defaultReasoningEffort: ReasoningEffort | null;
}) {
  const { browserKey } = useAuth();
  const { models } = useModelDiscovery();
  const keyState = useSyncExternalStore(browserKey.subscribe, browserKey.getSnapshot);
  const [showAttempt, setShowAttempt] = useState(false);
  const [showExtra, setShowExtra] = useState(false);
  const [externalPlanning, setExternalPlanning] = useState(false);
  const [planRefresh, setPlanRefresh] = useState(0);
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [problems, setProblems] = useState<CatalogListProblem[]>([]);
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [catalogNextPage, setCatalogNextPage] = useState<number | null>(0);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogLoadingMore, setCatalogLoadingMore] = useState(false);
  const [catalogError, setCatalogError] = useState<string>();
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [tutorBusy, setTutorBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [reload, setReload] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [classifying, setClassifying] = useState(false);
  const [incomplete, setIncomplete] = useState(false);
  const [decision, setDecision] = useState<"cancel" | "give-up" | null>(null);
  const decisionDialog = useRef<HTMLDialogElement>(null);
  const completionDialog = useRef<HTMLDialogElement>(null);
  const [saved, setSaved] = useState<Attempt | null>(null);
  const [memorySuggestions, setMemorySuggestions] = useState<MemorySuggestion[]>([]);
  const [assessmentDraft, setAssessmentDraft] = useState<AttemptAssessmentDraft | null>(null);
  const [assessmentLoadedFor, setAssessmentLoadedFor] = useState<string | null>(null);
  const [completedCode, setCompletedCode] = useState("");
  const [extraPracticeDate, setExtraPracticeDate] = useState<string | null>(null);
  const [extraPracticeDismissedDate, setExtraPracticeDismissedDate] = useState<string | null>(null);
  const [extraPracticeError, setExtraPracticeError] = useState<string>();
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogDifficulties, setCatalogDifficulties] = useState<CatalogDifficulty[]>([]);
  const [catalogAvailabilities, setCatalogAvailabilities] = useState<CatalogAvailability[]>([]);
  const [catalogProgress, setCatalogProgress] = useState<CatalogProgress[]>([]);
  const [selectedCatalogProblem, setSelectedCatalogProblem] = useState<CatalogListProblem | null>(
    null,
  );
  const [catalogSort, setCatalogSort] = useState<CatalogSort>("LEETCODE_ID");
  const [catalogSortDirection, setCatalogSortDirection] = useState<CatalogSortDirection>("ASC");
  const catalogSortMenu = useRef<HTMLDetailsElement>(null);
  const catalogFilterMenu = useRef<HTMLDetailsElement>(null);
  const catalogSentinel = useRef<HTMLDivElement>(null);
  const catalogLoadingMoreRef = useRef(false);

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
    setExtraPracticeError(undefined);
    void Promise.all([loadSavedDailyPlan(apiUrl, token), loadActiveAttempt(apiUrl, token)])
      .then(([dailyPlan, current]) => {
        if (active) {
          setPlan(dailyPlan);
          setAttempt(current);
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
  }, [apiUrl, token, reload, refresh]);

  useEffect(() => {
    const dialog = decisionDialog.current;
    if (decision !== null && view === "today") {
      if (!dialog?.open) dialog?.showModal();
    } else dialog?.close();
  }, [decision, view]);

  useEffect(() => {
    const dialog = completionDialog.current;
    if (saved !== null && view === "today") {
      if (!dialog?.open) dialog?.showModal();
    } else dialog?.close();
  }, [saved, view]);

  useEffect(() => {
    let active = true;
    catalogLoadingMoreRef.current = false;
    setCatalogLoading(true);
    setCatalogLoadingMore(false);
    setCatalogError(undefined);
    setProblems([]);
    setCatalogTotal(0);
    setCatalogNextPage(0);

    void loadProblems(apiUrl, token, {
      query: catalogQuery,
      difficulty: catalogDifficulties,
      availability: catalogAvailabilities,
      progress: catalogProgress,
      sort: catalogSort,
      sortDirection: catalogSortDirection,
      page: 0,
    })
      .then((catalog) => {
        if (!active) return;
        setProblems(catalog.problems);
        setCatalogTotal(catalog.total);
        setCatalogNextPage(catalog.nextPage);
      })
      .catch((reason: unknown) => {
        if (active) setCatalogError(message(reason));
      })
      .finally(() => {
        if (active) setCatalogLoading(false);
      });

    return () => {
      active = false;
    };
  }, [
    apiUrl,
    token,
    reload,
    catalogAvailabilities,
    catalogDifficulties,
    catalogQuery,
    catalogSort,
    catalogSortDirection,
    catalogProgress,
  ]);

  useEffect(() => {
    if (
      view !== "problems" ||
      catalogLoading ||
      catalogNextPage === null ||
      catalogLoadingMore ||
      catalogError !== undefined
    ) {
      return;
    }

    const sentinelElement = catalogSentinel.current;
    if (sentinelElement === null) return;
    const nextPage = catalogNextPage;

    function loadNextPage(): void {
      if (catalogLoadingMoreRef.current) return;

      catalogLoadingMoreRef.current = true;
      setCatalogLoadingMore(true);
      setCatalogError(undefined);

      void loadProblems(apiUrl, token, {
        query: catalogQuery,
        difficulty: catalogDifficulties,
        availability: catalogAvailabilities,
        progress: catalogProgress,
        sort: catalogSort,
        sortDirection: catalogSortDirection,
        page: nextPage,
      })
        .then((catalog) => {
          setProblems((current) => [...current, ...catalog.problems]);
          setCatalogTotal(catalog.total);
          setCatalogNextPage(catalog.nextPage);
        })
        .catch((reason: unknown) => setCatalogError(message(reason)))
        .finally(() => {
          catalogLoadingMoreRef.current = false;
          setCatalogLoadingMore(false);
        });
    }

    function loadWhenNearBottom(): void {
      if (sentinelElement!.getBoundingClientRect().top <= window.innerHeight + 400) {
        loadNextPage();
      }
    }

    if (typeof IntersectionObserver === "undefined") {
      window.addEventListener("scroll", loadWhenNearBottom, { passive: true });
      const interval = window.setInterval(loadWhenNearBottom, 250);
      loadWhenNearBottom();
      return () => {
        window.clearInterval(interval);
        window.removeEventListener("scroll", loadWhenNearBottom);
      };
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) loadNextPage();
      },
      { rootMargin: "400px" },
    );
    observer.observe(sentinelElement);
    return () => observer.disconnect();
  }, [
    apiUrl,
    token,
    loading,
    attempt,
    catalogAvailabilities,
    catalogDifficulties,
    catalogError,
    catalogLoading,
    catalogLoadingMore,
    view,
    catalogNextPage,
    catalogQuery,
    catalogSort,
    catalogSortDirection,
    catalogProgress,
  ]);

  useEffect(() => {
    setCompletedCode("");
  }, [attempt?.id]);

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

  const seconds = attempt === null ? 0 : remainingSeconds(attempt, now);

  useEffect(() => {
    document.title = attemptDocumentTitle(attempt, seconds);
  }, [attempt, seconds]);

  useEffect(
    () => () => {
      document.title = "Practice++";
    },
    [],
  );

  async function update(action: () => Promise<Attempt>) {
    setBusy(true);
    setError(undefined);
    try {
      setAttempt(await action());
      setShowAttempt(true);
      setSaved(null);
      setNow(Date.now());
      return true;
    } catch (reason) {
      setError(message(reason));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function cancelAttempt(): Promise<void> {
    if (attempt === null) return;
    setBusy(true);
    setError(undefined);
    try {
      await cancelActiveAttempt(apiUrl, token, attempt.id);
      setAttempt(null);
      setClassifying(false);
      setDecision(null);
      setSaved(null);
      setReload((value) => value + 1);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  async function generatePlan(personalized: boolean) {
    setBusy(true);
    setGeneratingPlan(true);
    setError(undefined);
    setExtraPracticeError(undefined);
    try {
      setPlan(
        personalized
          ? await generateIntegratedPlan(
              apiUrl,
              token,
              openAiSelection(defaultModel, models, defaultReasoningEffort),
              browserKey.getKey(userId) ?? "",
            )
          : await loadDailyPlan(apiUrl, token),
      );
      setPlanRefresh((value) => value + 1);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setGeneratingPlan(false);
      setBusy(false);
    }
  }

  const visible = problems;
  const filterCount =
    catalogDifficulties.length + catalogAvailabilities.length + catalogProgress.length;
  const planComplete =
    plan !== null &&
    plan.items.length > 0 &&
    plan.items.every((item) => item.status === "FINISHED");
  const extraPracticeStarted = plan !== null && extraPracticeDate === plan.practiceDate;
  const extraPracticeDismissed = plan !== null && extraPracticeDismissedDate === plan.practiceDate;

  function resetCatalogControls(): void {
    setCatalogQuery("");
    setCatalogDifficulties([]);
    setCatalogAvailabilities([]);
    setCatalogProgress([]);
    setCatalogSort("LEETCODE_ID");
    setCatalogSortDirection("ASC");
  }

  function clearCatalogFilters(): void {
    setCatalogDifficulties([]);
    setCatalogAvailabilities([]);
    setCatalogProgress([]);
  }

  async function startExtra(personalized: boolean): Promise<void> {
    setBusy(true);
    setExtraPracticeError(undefined);
    try {
      const next = personalized
        ? await generateExtraPracticeWithAi(
            apiUrl,
            token,
            openAiSelection(defaultModel, models, defaultReasoningEffort),
            browserKey.getKey(userId) ?? "",
          )
        : await startExtraPractice(apiUrl, token);
      if (next === null) {
        setExtraPracticeError(
          "No eligible extra practice problems remain. Your saved plan is unchanged.",
        );
        return;
      }
      setAttempt(next);
      setShowAttempt(true);
      setClassifying(false);
      setIncomplete(false);
      setShowExtra(false);
      setExtraPracticeDate(plan?.practiceDate ?? null);
      setSaved(null);
    } catch (reason) {
      setExtraPracticeError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  function startProblem(problemId: string): void {
    setClassifying(false);
    setIncomplete(false);
    onNavigate("practice");
    void update(() => startAttempt(apiUrl, token, problemId));
  }

  function resumeAttempt(): void {
    setShowAttempt(true);
    onNavigate("practice");
  }

  function stopExtra(): void {
    setShowExtra(false);
    if (plan !== null) setExtraPracticeDismissedDate(plan.practiceDate);
  }
  return (
    <section className="practice">
      {view === "today" && showAttempt && attempt !== null ? (
        <header className="practice-workspace-heading">
          <h2>Practice</h2>
          <button type="button" className="secondary-button" onClick={() => setShowAttempt(false)}>
            Back to Today
          </button>
        </header>
      ) : null}
      <dialog
        ref={decisionDialog}
        className="attempt-dialog"
        onCancel={(event) => {
          if (busy) event.preventDefault();
          else setDecision(null);
        }}
        onClose={() => setDecision(null)}
        aria-labelledby="attempt-decision-heading"
      >
        <h3 id="attempt-decision-heading">
          {decision === "cancel" ? "Discard this attempt?" : "Give up and review?"}
        </h3>
        <p>
          {decision === "cancel"
            ? "This deletes the attempt and its linked help, drafts, and summaries. No result or retry is saved. Today's assignment becomes available to start again."
            : "This reports gave up and reveals the patterns. You can review a solution and try it from memory. Either recall result keeps the outcome gave up."}
        </p>
        {decision === "cancel" ? (
          <p className="settings-help">
            To keep unfinished work and schedule a retry, save it as incomplete instead.
          </p>
        ) : null}
        <div className="account-actions">
          <button
            type="button"
            disabled={busy || tutorBusy}
            className={decision === "cancel" ? "danger-button" : "primary-button"}
            onClick={() => {
              if (decision === "cancel") void cancelAttempt();
              else if (attempt !== null)
                void update(() =>
                  reportAttempt(apiUrl, token, attempt.id, { outcome: "GAVE_UP" }),
                ).then((updated) => {
                  if (updated) {
                    setClassifying(false);
                    setIncomplete(false);
                    setDecision(null);
                  }
                });
            }}
          >
            {busy ? "Saving…" : decision === "cancel" ? "Discard attempt" : "Give up and continue"}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => setDecision(null)}
          >
            Keep attempt
          </button>
        </div>
        {error ? (
          <p className="auth-message" role="alert">
            {error}
          </p>
        ) : null}
      </dialog>
      <dialog
        ref={completionDialog}
        className="attempt-dialog"
        onCancel={() => setSaved(null)}
        onClose={() => setSaved(null)}
        aria-labelledby="attempt-confirmation-heading"
      >
        {saved ? (
          <>
            <h3 id="attempt-confirmation-heading">Attempt confirmed</h3>
            <p>
              {saved.problem.title} · {saved.outcome?.toLowerCase().replaceAll("_", " ")}
            </p>
            {loading ? (
              <p role="status">Updating daily progress…</p>
            ) : error !== undefined ? (
              <div role="alert">
                <p>The result was saved, but daily progress could not be refreshed.</p>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setReload((value) => value + 1)}
                >
                  Reload progress
                </button>
              </div>
            ) : (
              <p>
                {plan === null
                  ? "Outside a saved daily plan"
                  : `${plan.items.filter((item) => item.status === "FINISHED").length} / ${plan.items.length} assigned problems complete`}
              </p>
            )}
            {saved.outcome === "INCOMPLETE" ? (
              <p className="settings-help">
                Incomplete work does not count toward daily completion. The saved plan will not
                replace this assignment.
              </p>
            ) : null}
            {saved.review !== null ? (
              <>
                <p>
                  Next {saved.outcome === "INCOMPLETE" ? "retry" : "review"}:{" "}
                  {saved.review.manualDueDate ?? saved.review.generatedDueDate}
                </p>
                <details>
                  <summary>Change due date</summary>
                  <ReviewDateForm
                    apiUrl={apiUrl}
                    token={token}
                    attemptId={saved.id}
                    review={saved.review}
                    onSaved={(updated) =>
                      setSaved((previous) =>
                        previous === null ? null : { ...previous, review: updated.review },
                      )
                    }
                  />
                </details>
              </>
            ) : (
              <p>
                {saved.nextAction?.type === "TRANSFER"
                  ? `Fresh same-pattern transfer: ${saved.nextAction.pattern}. Eligible ${saved.nextAction.dueDate ?? "7 calendar days after this attempt"}. A matching problem is selected when a daily plan has space.`
                  : "No automatic follow-up."}
              </p>
            )}
            <div className="account-actions">
              {!loading &&
              error === undefined &&
              plan?.items.find((item) => item.status === "PENDING") ? (
                <button
                  type="button"
                  onClick={() => {
                    const next = plan.items.find((item) => item.status === "PENDING");
                    if (next) {
                      setSaved(null);
                      startProblem(next.problem.id);
                    }
                  }}
                  disabled={
                    busy ||
                    plan.items.find((item) => item.status === "PENDING")?.problem.availability ===
                      "UNAVAILABLE"
                  }
                >
                  Start next problem
                </button>
              ) : null}
              {!loading && error === undefined && planComplete ? (
                <button
                  type="button"
                  onClick={() => {
                    setSaved(null);
                    setShowExtra(true);
                    setExtraPracticeDismissedDate(null);
                  }}
                >
                  Choose extra practice
                </button>
              ) : null}
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  if (planComplete) stopExtra();
                  setSaved(null);
                }}
              >
                {" "}
                {planComplete ? "Finish for today" : "Back to Today"}
              </button>
            </div>
          </>
        ) : null}
      </dialog>
      {loading ? <p role="status">Loading practice…</p> : null}
      {error === undefined ? null : (
        <div className="practice-error">
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
        <div className="active-attempt" hidden={view !== "today" || !showAttempt}>
          <AttemptWorkspace
            attempt={attempt}
            seconds={seconds}
            busy={busy || tutorBusy}
            recording={classifying}
            completed={plan?.items.filter((item) => item.status === "FINISHED").length ?? 0}
            required={plan?.items.length ?? null}
            onPause={() =>
              void update(() =>
                attempt.timerPausedAt == null
                  ? pauseTimer(apiUrl, token, attempt.id)
                  : resumeTimer(apiUrl, token, attempt.id),
              )
            }
            onSkip={() => void update(() => skipTimer(apiUrl, token, attempt.id))}
            onReport={(unfinished) => {
              setIncomplete(unfinished);
              setClassifying(true);
            }}
            onReturn={() => setClassifying(false)}
            onGiveUp={() => setDecision("give-up")}
            onCancel={() => setDecision("cancel")}
            onReview={() => void update(() => reviewSolution(apiUrl, token, attempt.id))}
            externalAi={
              <details className="attempt-external page-surface">
                <summary>
                  External AI
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                </summary>
                {classifying && attempt.outcome === null ? (
                  <p className="settings-help">
                    Report your result before preparing result-recording context. Final confirmation
                    remains separate.
                  </p>
                ) : (
                  <ExternalAiExport
                    key={`${attempt.id}-${attempt.outcome ?? "solving"}-${classifying}`}
                    heading={null}
                    apiUrl={apiUrl}
                    token={token}
                    attempt={attempt}
                    resultOnly={
                      classifying || (attempt.outcome !== null && attempt.outcome !== "GAVE_UP")
                    }
                  />
                )}
              </details>
            }
            tutor={
              <AttemptTutor
                key={attempt.id}
                apiUrl={apiUrl}
                token={token}
                userId={userId}
                defaultModel={defaultModel}
                defaultReasoningEffort={defaultReasoningEffort}
                attempt={attempt}
                hintsAvailable={seconds === 0}
                disabled={busy}
                onAiSetup={() => onAiSetup("attempt")}
                onBusy={setTutorBusy}
                onRefresh={async () => {
                  try {
                    setAttempt(await loadActiveAttempt(apiUrl, token));
                  } catch {
                    setError("Reload practice to refresh recorded assistance before confirming.");
                  }
                }}
              />
            }
          >
            {(classifying || attempt.outcome !== null) && assessmentLoadedFor !== attempt.id ? (
              <p role="status">Loading assessment draft…</p>
            ) : classifying || attempt.outcome !== null ? (
              <AttemptOutcomeForm
                key={`${attempt.id}-${attempt.solutionReviewedAt ?? "solving"}-${JSON.stringify(attempt.summary)}-${assessmentDraft?.updatedAt ?? "no-draft"}-${incomplete}`}
                attempt={attempt}
                initialIncomplete={incomplete}
                onLearningProfile={() => onNavigate("learning")}
                memorySuggestions={memorySuggestions}
                assessmentDraft={assessmentDraft}
                canDraftAssessment={keyState.hasKey}
                completedCode={completedCode}
                onCompletedCodeChange={setCompletedCode}
                onDraftAssessment={async ({ completedCode: code, currentSummary }) => {
                  setBusy(true);
                  setError(undefined);
                  try {
                    const tutorConversation = loadTutorConversation(
                      window.sessionStorage,
                      userId,
                      attempt.id,
                    );
                    const tutorMessages = recentCoachMessages(
                      tutorConversation.messages
                        .slice(tutorConversation.checkpointIndex)
                        .filter((message) => message.complete)
                        .map(({ role, content }) => ({ role, content })),
                    );
                    setAssessmentDraft(
                      await generateAssessmentDraft(apiUrl, token, {
                        selection: openAiSelection(defaultModel, models, defaultReasoningEffort),
                        apiKey: browserKey.getKey(userId) ?? "",
                        attemptId: attempt.id,
                        completedCode: code,
                        currentSummary,
                        tutorMessages,
                      }),
                    );
                  } catch (reason) {
                    setError(message(reason));
                  } finally {
                    setBusy(false);
                  }
                }}
                busy={busy || tutorBusy}
                onReport={async (input) => {
                  await update(() => reportAttempt(apiUrl, token, attempt.id, input));
                }}
                onConfirm={async (input) => {
                  setBusy(true);
                  setError(undefined);
                  try {
                    const confirmed = await confirmAttempt(apiUrl, token, attempt.id, input);
                    setAttempt(null);
                    setSelectedCatalogProblem(null);
                    setClassifying(false);
                    setLoading(true);
                    setShowAttempt(false);
                    setSaved(confirmed);
                    setReload((value) => value + 1);
                  } catch (reason) {
                    setError(message(reason));
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            ) : null}
          </AttemptWorkspace>
        </div>
      ) : null}
      {!loading ? (
        <>
          <div hidden={view !== "today" || (attempt !== null && showAttempt)}>
            <Today
              apiUrl={apiUrl}
              token={token}
              settings={settings}
              plan={plan}
              attempt={attempt}
              busy={busy || tutorBusy}
              generatingPlan={generatingPlan}
              aiReady={keyState.hasKey}
              finishedForToday={extraPracticeDismissed}
              seconds={seconds}
              refresh={reload + planRefresh}
              onGenerate={(personalized) => void generatePlan(personalized)}
              onStart={startProblem}
              onResume={resumeAttempt}
              onBrowse={() => onNavigate("problems")}
              onAiSetup={() => onAiSetup("today")}
              onExternalAi={() => setExternalPlanning((open) => !open)}
              onExtra={() => {
                setShowExtra(true);
                setExtraPracticeDismissedDate(null);
              }}
              onStop={stopExtra}
            >
              {externalPlanning && (plan === null || plan.items.length === 0) ? (
                <ExternalAiExport
                  apiUrl={apiUrl}
                  token={token}
                  planningOnly
                  onPlanSaved={(savedPlan) => {
                    setPlan(savedPlan);
                    setExternalPlanning(false);
                    setPlanRefresh((value) => value + 1);
                  }}
                />
              ) : null}
              {showExtra && planComplete && !extraPracticeDismissed ? (
                <section
                  className="daily-plan extra-practice"
                  aria-labelledby="extra-practice-heading"
                >
                  <h3 id="extra-practice-heading">
                    {extraPracticeStarted ? "Extra practice" : "Daily plan complete"}
                  </h3>
                  <p>
                    {extraPracticeStarted
                      ? "Choose one more eligible problem, or finish for today."
                      : "Extra practice is optional. It counts in your calendar without changing today's saved plan or target."}
                  </p>
                  {extraPracticeError === undefined ? null : (
                    <p className="auth-message" role="alert">
                      {extraPracticeError}
                    </p>
                  )}
                  <div className="account-actions">
                    <button
                      type="button"
                      disabled={busy || !keyState.hasKey}
                      onClick={() => void startExtra(true)}
                    >
                      {busy
                        ? "Choosing problem…"
                        : extraPracticeStarted
                          ? "Choose another with AI"
                          : "Continue with AI"}
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={busy}
                      onClick={() => void startExtra(false)}
                    >
                      {extraPracticeStarted ? "Choose another without AI" : "Continue without AI"}
                    </button>
                    {extraPracticeStarted ? (
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={busy}
                        onClick={stopExtra}
                      >
                        Done with extra practice
                      </button>
                    ) : null}
                  </div>
                  {!keyState.hasKey ? (
                    <p className="settings-help">
                      Add an OpenAI API key in Practice settings to personalize the extra problem,
                      or continue without AI.
                    </p>
                  ) : null}
                </section>
              ) : null}
            </Today>
          </div>
          <div hidden={view !== "problems"}>
            <header className="problems-heading">
              <h2>Problems</h2>
              <p className="settings-help">Choose a problem for your practice.</p>
            </header>
            {attempt !== null ? (
              <div className="practice-resume-banner">
                <div>
                  <strong>Active attempt: {attempt.problem.title}</strong>
                  <p className="settings-help">
                    {attempt.timerPausedAt ? "Timer paused" : "Time remaining"} ·{" "}
                    {formatRemainingSeconds(seconds)}
                  </p>
                </div>
                <button type="button" disabled={busy || tutorBusy} onClick={resumeAttempt}>
                  Resume attempt
                </button>
              </div>
            ) : null}
            {selectedCatalogProblem === null ? (
              <section className="catalog-browser page-surface">
                <div className="catalog-heading">
                  <div>
                    <h3>Problem catalog</h3>
                    <p className="settings-help">
                      Browse {catalogTotal} published {catalogTotal === 1 ? "problem" : "problems"}.
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
                  <details
                    ref={catalogSortMenu}
                    className="catalog-sort-menu"
                    name="catalog-controls"
                  >
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
                            <span aria-hidden="true">
                              {catalogSortDirection === "ASC" ? "↑" : "↓"}
                            </span>
                          ) : null}
                        </button>
                      ))}
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
                                setCatalogDifficulties((current) =>
                                  toggleValue(current, option.value),
                                )
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
                        <legend>Progress</legend>
                        {catalogProgressOptions.map((option) => (
                          <label key={option.value}>
                            <input
                              type="checkbox"
                              checked={catalogProgress.includes(option.value)}
                              onChange={() =>
                                setCatalogProgress((current) => toggleValue(current, option.value))
                              }
                            />
                            {option.label}
                          </label>
                        ))}
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
                {catalogLoading ? (
                  <p className="settings-help" role="status">
                    Loading catalog…
                  </p>
                ) : catalogError !== undefined ? (
                  <div className="catalog-empty">
                    <p className="auth-message" role="alert">
                      {catalogError}
                    </p>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setReload((value) => value + 1)}
                    >
                      Reload catalog
                    </button>
                  </div>
                ) : visible.length === 0 ? (
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
                      Showing {visible.length} of {catalogTotal}
                    </p>
                    <ul className="problem-list catalog-problem-list">
                      {visible.map((problem) => (
                        <li key={problem.id}>
                          <div className="catalog-problem-title">
                            <button
                              className="catalog-problem-link"
                              type="button"
                              onClick={() => setSelectedCatalogProblem(problem)}
                            >
                              <strong>
                                {problem.leetcodeId}. {problem.title}
                              </strong>
                            </button>
                          </div>
                          <div
                            className={
                              problem.availability !== "AVAILABLE" && problem.solved
                                ? "catalog-problem-meta catalog-problem-meta-with-availability"
                                : "catalog-problem-meta"
                            }
                          >
                            <span
                              className={`catalog-difficulty catalog-difficulty-${problem.difficulty.toLocaleLowerCase()}`}
                            >
                              {labelForValue(problem.difficulty)}
                            </span>
                            {problem.availability !== "AVAILABLE" ? (
                              <span className="catalog-availability">
                                {problem.availability === "PAID_ONLY" ? "Premium" : "Unavailable"}
                              </span>
                            ) : null}
                            {problem.solved ? <span className="catalog-solved">Solved</span> : null}
                          </div>
                          <button
                            type="button"
                            disabled={
                              busy ||
                              tutorBusy ||
                              attempt !== null ||
                              problem.availability === "UNAVAILABLE"
                            }
                            onClick={() => startProblem(problem.id)}
                          >
                            {problem.availability === "UNAVAILABLE" ? "Unavailable" : "Start"}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <div ref={catalogSentinel} className="catalog-load-sentinel" aria-hidden="true" />
                {catalogLoadingMore ? (
                  <p className="settings-help" role="status">
                    Loading more problems…
                  </p>
                ) : null}
              </section>
            ) : (
              <CatalogProblemDetails
                key={selectedCatalogProblem.id}
                apiUrl={apiUrl}
                token={token}
                problem={selectedCatalogProblem}
                disabled={busy || tutorBusy || attempt !== null}
                onStart={startProblem}
                onBack={() => setSelectedCatalogProblem(null)}
              />
            )}
          </div>
        </>
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
];

const catalogProgressOptions: ReadonlyArray<{
  readonly label: string;
  readonly value: CatalogProgress;
}> = [
  { label: "Solved", value: "SOLVED" },
  { label: "Unsolved", value: "UNSOLVED" },
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
