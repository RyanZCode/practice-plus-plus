import {
  practiceSettingsSchema,
  type PracticeSettings,
  type ProblemDifficultyPreference,
  type ReasoningEffort,
} from "@practice-plus-plus/contracts";
import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";

import { AttemptHistory } from "../features/attempts/AttemptHistory";
import { Analytics } from "../features/analytics/Analytics";
import { authenticatedUserId } from "../features/auth/authState";
import { useAuth } from "../features/auth/auth";
import { ProtectedRoute } from "../features/auth/ProtectedRoute";
import { Coach } from "../features/coach/Coach";
import { LearningContext } from "../features/learning-context/LearningContext";
import { Practice } from "../features/practice/Practice";
import { BrowserKeySettings } from "../features/settings/BrowserKeySettings";
import { ModelDiscoveryProvider } from "../features/settings/ModelDiscovery";
import { OpenAIModelSelect } from "../features/settings/OpenAIModelSelect";
import { ReasoningEffortSelect } from "../features/settings/ReasoningEffortSelect";
import { loadPracticeSettings, savePracticeSettings } from "../features/settings/settingsApi";
import { clearTutorConversationsForUser } from "../features/tutor/tutorConversationStorage";
import { loadTheme, resolveTheme, saveTheme, type ThemePreference } from "../shared/theme";
import { NavigationIcon } from "./NavigationIcon";

interface AppProps {
  readonly apiUrl: string;
}

interface SettingsDraft {
  readonly allowPremiumProblems: boolean;
  readonly attemptTimerMinutes: string;
  readonly defaultAiModel: string;
  readonly difficultyPreference: ProblemDifficultyPreference;
  readonly reasoningEffort: ReasoningEffort | "";
  readonly dailyTarget: string;
  readonly highInterval: string;
  readonly lowInterval: string;
  readonly mediumInterval: string;
  readonly resetTime: string;
  readonly timeZone: string;
}

type ActiveView =
  "analytics" | "coach" | "history" | "learning" | "practice" | "problems" | "settings";

const navigationItems: ReadonlyArray<{ readonly label: string; readonly view: ActiveView }> = [
  { label: "Today", view: "practice" },
  { label: "Problems", view: "problems" },
  { label: "Coach", view: "coach" },
  { label: "Progress", view: "analytics" },
  { label: "History", view: "history" },
];

const secondaryNavigationItems: typeof navigationItems = [
  { label: "Learning profile", view: "learning" },
  { label: "Settings", view: "settings" },
];

export function App({ apiUrl }: AppProps) {
  const [themePreference, setThemePreference] = useState<ThemePreference>(() =>
    loadTheme(window.localStorage),
  );

  useEffect(() => {
    const colorSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)");

    function applyTheme(): void {
      document.documentElement.dataset.theme = resolveTheme(
        themePreference,
        colorSchemeQuery.matches,
      );
    }

    applyTheme();

    if (themePreference !== "system") {
      return;
    }

    colorSchemeQuery.addEventListener("change", applyTheme);
    return () => colorSchemeQuery.removeEventListener("change", applyTheme);
  }, [themePreference]);

  function changeTheme(preference: ThemePreference): void {
    setThemePreference(preference);
    saveTheme(window.localStorage, preference);
  }

  return (
    <ProtectedRoute>
      <ModelDiscoveryProvider apiUrl={apiUrl}>
        <AccountPage
          apiUrl={apiUrl}
          themePreference={themePreference}
          onThemeChange={changeTheme}
        />
      </ModelDiscoveryProvider>
    </ProtectedRoute>
  );
}

interface AccountPageProps extends AppProps {
  readonly onThemeChange: (theme: ThemePreference) => void;
  readonly themePreference: ThemePreference;
}

function AccountPage({ apiUrl, onThemeChange, themePreference }: AccountPageProps) {
  const { browserKey, signOut, state } = useAuth();
  const keyState = useSyncExternalStore(browserKey.subscribe, browserKey.getSnapshot);
  const userId = authenticatedUserId(state);
  const accessToken = state.status === "authenticated" ? state.session.access_token : null;
  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;
  const [draft, setDraft] = useState<SettingsDraft>(() => defaultDraft());
  const [savedSettings, setSavedSettings] = useState<PracticeSettings | null>(null);
  const [error, setError] = useState<string>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [setupStep, setSetupStep] = useState(0);
  const setupHeadingRef = useRef<HTMLHeadingElement>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeView, setActiveView] = useState<ActiveView>("practice");
  const [visitedViews, setVisitedViews] = useState<ReadonlySet<ActiveView>>(
    () => new Set(["practice"]),
  );
  const [focusMemoryInferences, setFocusMemoryInferences] = useState(false);
  const [reloadCount, setReloadCount] = useState(0);
  const [practiceRefresh, setPracticeRefresh] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (mobileMenuOpen) mobileMenuRef.current?.querySelector("button")?.focus();
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (isOnboarding) setupHeadingRef.current?.focus();
  }, [isOnboarding, setupStep]);

  useEffect(() => {
    if (window.location.pathname === "/auth/callback") {
      window.history.replaceState(null, "", "/");
    }
  }, []);

  useEffect(() => {
    if (userId === null) {
      return;
    }

    let active = true;
    setError(undefined);
    setLoadFailed(false);
    setIsLoading(true);

    const currentAccessToken = accessTokenRef.current;
    if (currentAccessToken === null) return;

    void loadPracticeSettings(apiUrl, currentAccessToken)
      .then((settings) => {
        if (!active) {
          return;
        }

        setIsOnboarding(settings === null);
        setSavedSettings(settings);
        setDraft(settings === null ? defaultDraft() : toDraft(settings));
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(errorMessage(loadError));
          setLoadFailed(true);
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [apiUrl, reloadCount, userId]);

  if (state.status !== "authenticated") {
    return null;
  }

  const session = state.session;

  async function handleSave(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(undefined);
    setLoadFailed(false);
    setSaved(false);

    const result = parseSettingsDraft(draft);

    if (!result.success) {
      setError("Check the timezone, reset time, timer, target, and review interval order.");
      return;
    }

    setIsSaving(true);

    try {
      const settings = await savePracticeSettings(apiUrl, session.access_token, result.data);
      setDraft(toDraft(settings));
      setSavedSettings(settings);
      setIsOnboarding(false);
      setSaved(true);
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSignOut(): Promise<void> {
    setError(undefined);
    setIsSigningOut(true);

    try {
      if (userId !== null) clearTutorConversationsForUser(window.sessionStorage, userId);
      await signOut();
    } catch (signOutError) {
      setError(errorMessage(signOutError));
      setIsSigningOut(false);
    }
  }

  function navigate(view: ActiveView): void {
    setActiveView(view);
    if (mobileMenuOpen) mobileMenuButtonRef.current?.focus();
    setMobileMenuOpen(false);
    setVisitedViews((views) => {
      if (views.has(view)) return views;
      return new Set([...views, view]);
    });
  }

  function changeSetupStep(step: number): void {
    setError(undefined);
    if (step > setupStep) {
      const result = parseSettingsDraft(draft);
      const dailyFields = ["timeZone", "resetTime", "dailyTarget"];
      if (
        !result.success &&
        result.error.issues.some(
          (issue) => step === 2 || dailyFields.includes(String(issue.path[0])),
        )
      ) {
        setError(
          step === 1
            ? "Choose a valid timezone, reset time, and daily target from 1 to 20."
            : "Check the timer and redo intervals. Keep high ≤ medium ≤ low.",
        );
        return;
      }
    }
    setSetupStep(step);
  }

  const showNavigation = !isLoading && !loadFailed && !isOnboarding;
  const modelControls = (
    <div className="ai-control-grid">
      <OpenAIModelSelect
        value={draft.defaultAiModel}
        disabled={isSaving}
        onChange={(defaultAiModel) => setDraft({ ...draft, defaultAiModel })}
        label={isOnboarding ? "OpenAI model" : "Default OpenAI model"}
        help={isOnboarding ? "" : "Used when you open Coach or Attempt tutor."}
      />

      <ReasoningEffortSelect
        model={draft.defaultAiModel}
        value={draft.reasoningEffort === "" ? null : draft.reasoningEffort}
        disabled={isSaving}
        onChange={(reasoningEffort) =>
          setDraft({ ...draft, reasoningEffort: reasoningEffort ?? "" })
        }
      />
    </div>
  );
  const appearanceControls = (
    <fieldset className="appearance-setting">
      <legend>Appearance</legend>
      <div className="appearance-options">
        {appearanceOptions.map((option) => (
          <label key={option.value}>
            <input
              type="radio"
              name="appearance"
              value={option.value}
              checked={themePreference === option.value}
              onChange={() => onThemeChange(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <h1 className="brand-heading">
          <button
            className="brand-button"
            type="button"
            aria-label="Practice++, open today’s practice"
            aria-current={showNavigation && activeView === "practice" ? "page" : undefined}
            onClick={() => navigate("practice")}
          >
            <img className="brand-mark" src="/practice-plus-plus.svg" alt="" />
            <strong>Practice++</strong>
          </button>
        </h1>

        {showNavigation ? (
          <>
            <Navigation activeView={activeView} onNavigate={navigate} />
            <Navigation activeView={activeView} onNavigate={navigate} secondary />
          </>
        ) : null}

        <details className="account-summary">
          <summary aria-label="Account">
            {(session.user.email ?? "Account").charAt(0).toUpperCase()}
          </summary>
          <div className="account-menu">
            <p className="account-email">
              {session.user.email === undefined ? "You’re signed in." : session.user.email}
            </p>
            <button
              className="sign-out-button"
              type="button"
              disabled={isSigningOut}
              onClick={() => void handleSignOut()}
            >
              {isSigningOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </details>
      </aside>

      <section className="workspace-panel">
        <header className="mobile-header">
          <h1 className="mobile-brand-heading">
            <button
              className="mobile-brand"
              type="button"
              aria-label="Practice++, open today’s practice"
              onClick={() => navigate("practice")}
            >
              <img className="brand-mark" src="/practice-plus-plus.svg" alt="" />
              Practice++
            </button>
          </h1>
          {showNavigation ? (
            <button
              className="mobile-menu-button"
              type="button"
              aria-label="More navigation"
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-menu"
              onClick={(event) => {
                mobileMenuButtonRef.current = event.currentTarget;
                setMobileMenuOpen((open) => !open);
              }}
            >
              <NavigationIcon name="more" />
            </button>
          ) : (
            <button
              className="mobile-sign-out"
              type="button"
              disabled={isSigningOut}
              onClick={() => void handleSignOut()}
            >
              {isSigningOut ? "Signing out…" : "Sign out"}
            </button>
          )}
        </header>

        <header className="workspace-header">
          <span>Practice++</span>
          <span aria-hidden="true">/</span>
          <strong>
            {isOnboarding
              ? "Setup"
              : [...navigationItems, ...secondaryNavigationItems].find(
                  (item) => item.view === activeView,
                )?.label}
          </strong>
        </header>

        {showNavigation && mobileMenuOpen ? (
          <div
            id="mobile-menu"
            className="mobile-menu"
            ref={mobileMenuRef}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setMobileMenuOpen(false);
                mobileMenuButtonRef.current?.focus();
              }
            }}
          >
            <Navigation activeView={activeView} onNavigate={navigate} secondary mobile />
            <p className="account-email">{session.user.email}</p>
            <button
              className="mobile-sign-out"
              type="button"
              disabled={isSigningOut}
              onClick={() => void handleSignOut()}
            >
              {isSigningOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        ) : null}

        {showNavigation ? (
          <div className="mobile-navigation">
            <Navigation activeView={activeView} onNavigate={navigate} mobile />
            <button
              className="navigation-button mobile-more"
              type="button"
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-menu"
              onClick={(event) => {
                mobileMenuButtonRef.current = event.currentTarget;
                setMobileMenuOpen((open) => !open);
              }}
            >
              <NavigationIcon name="more" />
              <span>More</span>
            </button>
          </div>
        ) : null}

        <main
          className={`workspace-content${activeView === "practice" || activeView === "problems" ? " practice-content" : ""}`}
        >
          {isLoading ? <p className="settings-status">Loading practice settings…</p> : null}

          {!isLoading && loadFailed && error !== undefined ? (
            <div className="settings-status">
              <p className="auth-message" role="alert">
                {error}
              </p>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setReloadCount((count) => count + 1)}
              >
                Try again
              </button>
            </div>
          ) : null}

          {!isLoading && !loadFailed && !isOnboarding ? (
            <div hidden={activeView !== "practice" && activeView !== "problems"}>
              <Practice
                key={session.user.id}
                apiUrl={apiUrl}
                token={session.access_token}
                userId={session.user.id}
                defaultModel={savedSettings?.defaultAiModel ?? "gpt-5.4-mini"}
                defaultReasoningEffort={savedSettings?.reasoningEffort ?? null}
                view={activeView === "problems" ? "problems" : "today"}
                settings={savedSettings!}
                onNavigate={navigate}
                refresh={practiceRefresh}
              />
            </div>
          ) : null}

          <div hidden={isLoading || loadFailed || isOnboarding || activeView !== "coach"}>
            <Coach
              isActive={activeView === "coach"}
              key={session.user.id}
              apiUrl={apiUrl}
              token={session.access_token}
              userId={session.user.id}
              defaultModel={savedSettings?.defaultAiModel ?? "gpt-5.4-mini"}
              defaultReasoningEffort={savedSettings?.reasoningEffort ?? null}
              onReviewMemory={() => {
                setFocusMemoryInferences(true);
                navigate("learning");
              }}
              onAiSetup={() => navigate("settings")}
              onPlanSaved={() => {
                setPracticeRefresh((value) => value + 1);
                navigate("practice");
              }}
            />
          </div>

          {!isLoading && !loadFailed && !isOnboarding && visitedViews.has("history") ? (
            <div hidden={activeView !== "history"}>
              <AttemptHistory apiUrl={apiUrl} token={session.access_token} />
            </div>
          ) : null}

          {!isLoading && !loadFailed && !isOnboarding && visitedViews.has("analytics") ? (
            <div hidden={activeView !== "analytics"}>
              <Analytics apiUrl={apiUrl} token={session.access_token} />
            </div>
          ) : null}

          {!isLoading && !loadFailed && !isOnboarding && visitedViews.has("learning") ? (
            <div hidden={activeView !== "learning"}>
              <LearningContext
                apiUrl={apiUrl}
                token={session.access_token}
                focusInferences={focusMemoryInferences}
                onFocusHandled={() => setFocusMemoryInferences(false)}
              />
            </div>
          ) : null}

          {!isLoading &&
          !loadFailed &&
          !isOnboarding &&
          activeView !== "settings" &&
          activeView !== "learning" &&
          error !== undefined ? (
            <p className="auth-message" role="alert">
              {error}
            </p>
          ) : null}

          {!isLoading && !loadFailed && (isOnboarding || activeView === "settings") ? (
            <section className={isOnboarding ? "onboarding" : "settings-page-wrapper"}>
              {isOnboarding ? (
                <>
                  <header className="setup-heading">
                    <h2 ref={setupHeadingRef} tabIndex={-1}>
                      Set up your practice
                    </h2>
                  </header>
                  <nav className="setup-steps" aria-label="Setup steps">
                    {["Daily practice", "Preferences", "AI setup"].map((label, step) => (
                      <Fragment key={label}>
                        {step > 0 ? (
                          <span className="setup-step-connector" aria-hidden="true" />
                        ) : null}
                        <button
                          type="button"
                          className="setup-step"
                          aria-current={setupStep === step ? "step" : undefined}
                          disabled={isSaving}
                          onClick={() => changeSetupStep(step)}
                        >
                          <span aria-hidden="true">{step + 1}</span>
                          {label}
                        </button>
                      </Fragment>
                    ))}
                  </nav>
                </>
              ) : null}
              <form
                id="practice-settings"
                className="settings-form settings-page page-surface"
                hidden={isOnboarding && setupStep === 2}
                noValidate={isOnboarding}
                onSubmit={(event) => {
                  if (isOnboarding && setupStep < 2) {
                    event.preventDefault();
                    changeSetupStep(setupStep + 1);
                  } else {
                    void handleSave(event);
                  }
                }}
              >
                {!isOnboarding ? (
                  <div>
                    <h2>Practice settings</h2>
                    <p className="settings-help">
                      Today’s selections stay fixed. Settings changes apply to the next plan.
                    </p>
                  </div>
                ) : null}

                {!isOnboarding ? appearanceControls : null}

                <div
                  className="settings-section setup-daily-fields"
                  hidden={isOnboarding && setupStep !== 0}
                >
                  {isOnboarding ? <h3>Daily practice</h3> : null}
                  <label>
                    Timezone
                    <select
                      value={draft.timeZone}
                      onChange={(event) => setDraft({ ...draft, timeZone: event.target.value })}
                    >
                      {timeZoneOptions(draft.timeZone).map((timeZone) => (
                        <option key={timeZone} value={timeZone}>
                          {timeZone.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Practice day resets at
                    <input
                      type="time"
                      value={draft.resetTime}
                      onChange={(event) => setDraft({ ...draft, resetTime: event.target.value })}
                    />
                  </label>

                  <label>
                    Daily problem target (1-20)
                    <input
                      max="20"
                      min="1"
                      step="1"
                      type="number"
                      value={draft.dailyTarget}
                      onChange={(event) => setDraft({ ...draft, dailyTarget: event.target.value })}
                    />
                  </label>
                </div>
                <div className="settings-section" hidden={isOnboarding && setupStep !== 1}>
                  {isOnboarding ? <h3>Practice preferences</h3> : null}
                  <label>
                    Automatic problem difficulty
                    <select
                      value={draft.difficultyPreference}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          difficultyPreference: event.target.value as ProblemDifficultyPreference,
                        })
                      }
                    >
                      <option value="ANY">Adaptive</option>
                      <option value="EASIER">Easier</option>
                      <option value="MEDIUM_ONLY">Medium only</option>
                    </select>
                    <span className="settings-help">
                      Easier excludes Hard problems and lets AI include approachable Medium
                      problems. Medium only restricts new selections to Medium problems.
                    </span>
                  </label>

                  <label>
                    Default attempt timer (minutes)
                    <input
                      max="180"
                      min="1"
                      step="1"
                      type="number"
                      value={draft.attemptTimerMinutes}
                      onChange={(event) =>
                        setDraft({ ...draft, attemptTimerMinutes: event.target.value })
                      }
                    />
                  </label>

                  <label className="premium-setting">
                    <input
                      type="checkbox"
                      checked={draft.allowPremiumProblems}
                      onChange={(event) =>
                        setDraft({ ...draft, allowPremiumProblems: event.target.checked })
                      }
                    />
                    <span>
                      Allow Premium problems in automatic selections
                      <span className="settings-help">
                        Premium problems remain visible in the catalog, but AI and non-AI planning
                        will not select them when this is disabled.
                      </span>
                    </span>
                  </label>

                  {!isOnboarding ? modelControls : null}

                  <fieldset>
                    <legend>Redo intervals (days)</legend>
                    <div className="interval-grid">
                      <label>
                        High
                        <input
                          max="90"
                          min="1"
                          step="1"
                          type="number"
                          value={draft.highInterval}
                          onChange={(event) =>
                            setDraft({ ...draft, highInterval: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        Medium
                        <input
                          max="90"
                          min="1"
                          step="1"
                          type="number"
                          value={draft.mediumInterval}
                          onChange={(event) =>
                            setDraft({ ...draft, mediumInterval: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        Low
                        <input
                          max="90"
                          min="1"
                          step="1"
                          type="number"
                          value={draft.lowInterval}
                          onChange={(event) =>
                            setDraft({ ...draft, lowInterval: event.target.value })
                          }
                        />
                      </label>
                    </div>
                  </fieldset>

                  {isOnboarding ? appearanceControls : null}
                </div>
                {isOnboarding || error === undefined ? null : (
                  <p className="auth-message" role="alert">
                    {error}
                  </p>
                )}

                {saved ? (
                  <p className="save-message" role="status">
                    Settings saved.
                  </p>
                ) : null}

                {!isOnboarding ? (
                  <button type="submit" disabled={isSaving}>
                    {isSaving ? "Saving…" : "Save settings"}
                  </button>
                ) : null}
              </form>
              {isOnboarding && setupStep === 2 ? (
                <section className="setup-ai page-surface" aria-labelledby="setup-ai-heading">
                  <h3 id="setup-ai-heading">
                    AI setup <span>Optional</span>
                  </h3>
                  <BrowserKeySettings key={session.user.id} embedded />
                  <div className="settings-form setup-models">{modelControls}</div>
                </section>
              ) : null}
              {isOnboarding && error !== undefined ? (
                <p className="auth-message" role="alert">
                  {error}
                </p>
              ) : null}
              {isOnboarding ? (
                <div className="setup-actions">
                  {setupStep > 0 ? (
                    <button
                      type="button"
                      className="secondary-button setup-back"
                      disabled={isSaving}
                      onClick={() => changeSetupStep(setupStep - 1)}
                    >
                      Back
                    </button>
                  ) : null}
                  {setupStep === 2 && !keyState.hasKey ? (
                    <button
                      type="submit"
                      form="practice-settings"
                      className="secondary-button setup-skip"
                      disabled={isSaving}
                    >
                      Continue without AI
                    </button>
                  ) : null}
                  {setupStep < 2 ? (
                    <button
                      type="submit"
                      form="practice-settings"
                      className="setup-primary"
                      disabled={isSaving}
                    >
                      Continue
                    </button>
                  ) : (
                    <button
                      type="submit"
                      form="practice-settings"
                      className="setup-primary"
                      disabled={isSaving}
                    >
                      {isSaving ? "Saving…" : "Start practicing"}
                    </button>
                  )}
                </div>
              ) : null}
            </section>
          ) : null}
          {!isLoading && !loadFailed && !isOnboarding && activeView === "settings" ? (
            <BrowserKeySettings key={session.user.id} />
          ) : null}
        </main>
      </section>
    </div>
  );
}

interface NavigationProps {
  readonly activeView: ActiveView;
  readonly onNavigate: (view: ActiveView) => void;
  readonly secondary?: boolean;
  readonly mobile?: boolean;
}

const appearanceOptions: ReadonlyArray<{
  readonly label: string;
  readonly value: ThemePreference;
}> = [
  { label: "System default", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];

function Navigation({
  activeView,
  onNavigate,
  secondary = false,
  mobile = false,
}: NavigationProps) {
  return (
    <nav
      className={`workspace-navigation${secondary ? " secondary-navigation" : ""}`}
      aria-label={secondary ? "Secondary navigation" : "Primary navigation"}
    >
      {(secondary ? secondaryNavigationItems : navigationItems).map((item) => (
        <button
          className="navigation-button"
          type="button"
          aria-current={activeView === item.view ? "page" : undefined}
          aria-controls={item.view === "settings" ? "practice-settings" : undefined}
          key={item.view}
          aria-label={item.label}
          onClick={() => onNavigate(item.view)}
        >
          <NavigationIcon name={item.view} />
          <span className={mobile ? "navigation-label" : "navigation-tooltip"}>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

function parseSettingsDraft(draft: SettingsDraft) {
  return practiceSettingsSchema.safeParse({
    defaultAiModel: draft.defaultAiModel,
    reasoningEffort: draft.reasoningEffort === "" ? null : draft.reasoningEffort,
    attemptTimerMinutes: Number(draft.attemptTimerMinutes),
    allowPremiumProblems: draft.allowPremiumProblems,
    difficultyPreference: draft.difficultyPreference,
    dailyTarget: Number(draft.dailyTarget),
    redoIntervals: {
      high: Number(draft.highInterval),
      low: Number(draft.lowInterval),
      medium: Number(draft.mediumInterval),
    },
    resetTime: draft.resetTime,
    timeZone: draft.timeZone,
  });
}

function defaultDraft(): SettingsDraft {
  return {
    allowPremiumProblems: true,
    defaultAiModel: "gpt-5.4-mini",
    difficultyPreference: "ANY",
    reasoningEffort: "",
    attemptTimerMinutes: "30",
    dailyTarget: "2",
    highInterval: "1",
    lowInterval: "7",
    mediumInterval: "3",
    resetTime: "04:00",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };
}

const supportedTimeZones = (() => {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
})();

function timeZoneOptions(currentTimeZone: string): readonly string[] {
  return Array.from(new Set(["UTC", currentTimeZone, ...supportedTimeZones])).sort((left, right) =>
    left.localeCompare(right),
  );
}

function toDraft(settings: PracticeSettings): SettingsDraft {
  return {
    allowPremiumProblems: settings.allowPremiumProblems,
    defaultAiModel: settings.defaultAiModel,
    difficultyPreference: settings.difficultyPreference,
    reasoningEffort: settings.reasoningEffort ?? "",
    attemptTimerMinutes: String(settings.attemptTimerMinutes),
    dailyTarget: String(settings.dailyTarget),
    highInterval: String(settings.redoIntervals.high),
    lowInterval: String(settings.redoIntervals.low),
    mediumInterval: String(settings.redoIntervals.medium),
    resetTime: settings.resetTime,
    timeZone: settings.timeZone,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
