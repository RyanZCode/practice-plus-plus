import { practiceSettingsSchema, type PracticeSettings } from "@practice-plus-plus/contracts";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { AttemptHistory } from "../features/attempts/AttemptHistory";
import { authenticatedUserId } from "../features/auth/authState";
import { useAuth } from "../features/auth/auth";
import { ProtectedRoute } from "../features/auth/ProtectedRoute";
import { Coach } from "../features/coach/Coach";
import { ExternalAiExport } from "../features/external-ai/ExternalAiExport";
import { LearningContext } from "../features/learning-context/LearningContext";
import { Practice } from "../features/practice/Practice";
import { BrowserKeySettings } from "../features/settings/BrowserKeySettings";
import { OpenAIModelSelect } from "../features/settings/OpenAIModelSelect";
import { loadPracticeSettings, savePracticeSettings } from "../features/settings/settingsApi";
import { clearTutorConversationsForUser } from "../features/tutor/tutorConversationStorage";
import { loadTheme, resolveTheme, saveTheme, type ThemePreference } from "../shared/theme";

interface AppProps {
  readonly apiUrl: string;
}

interface SettingsDraft {
  readonly attemptTimerMinutes: string;
  readonly defaultAiModel: string;
  readonly dailyTarget: string;
  readonly highInterval: string;
  readonly lowInterval: string;
  readonly mediumInterval: string;
  readonly resetTime: string;
  readonly timeZone: string;
}

type ActiveView = "coach" | "external-ai" | "history" | "learning" | "practice" | "settings";

const navigationItems: ReadonlyArray<{ readonly label: string; readonly view: ActiveView }> = [
  { label: "Today", view: "practice" },
  { label: "Coach", view: "coach" },
  { label: "History", view: "history" },
  { label: "Memory", view: "learning" },
  { label: "AI Export", view: "external-ai" },
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
      <AccountPage apiUrl={apiUrl} themePreference={themePreference} onThemeChange={changeTheme} />
    </ProtectedRoute>
  );
}

interface AccountPageProps extends AppProps {
  readonly onThemeChange: (theme: ThemePreference) => void;
  readonly themePreference: ThemePreference;
}

function AccountPage({ apiUrl, onThemeChange, themePreference }: AccountPageProps) {
  const { signOut, state } = useAuth();
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
  const [isSaving, setIsSaving] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeView, setActiveView] = useState<ActiveView>("practice");
  const [focusMemoryInferences, setFocusMemoryInferences] = useState(false);
  const [reloadCount, setReloadCount] = useState(0);

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

    const result = practiceSettingsSchema.safeParse({
      defaultAiModel: draft.defaultAiModel,
      attemptTimerMinutes: Number(draft.attemptTimerMinutes),
      dailyTarget: Number(draft.dailyTarget),
      redoIntervals: {
        high: Number(draft.highInterval),
        low: Number(draft.lowInterval),
        medium: Number(draft.mediumInterval),
      },
      resetTime: draft.resetTime,
      timeZone: draft.timeZone,
    });

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

  const showNavigation = !isLoading && !loadFailed && !isOnboarding;

  return (
    <main className="app-shell">
      <aside className="app-sidebar">
        <h1 className="brand-heading">
          <button
            className="brand-button"
            type="button"
            aria-label="Practice++, open today’s practice"
            aria-current={showNavigation && activeView === "practice" ? "page" : undefined}
            onClick={() => setActiveView("practice")}
          >
            <span className="brand-mark" aria-hidden="true">
              P++
            </span>
            <strong>Practice++</strong>
          </button>
        </h1>

        {showNavigation ? <Navigation activeView={activeView} onNavigate={setActiveView} /> : null}

        <div className="account-summary">
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
      </aside>

      <section className="workspace-panel">
        <header className="mobile-header">
          <h1 className="mobile-brand-heading">
            <button
              className="mobile-brand"
              type="button"
              aria-label="Practice++, open today’s practice"
              onClick={() => setActiveView("practice")}
            >
              Practice++
            </button>
          </h1>
          <button
            className="mobile-sign-out"
            type="button"
            disabled={isSigningOut}
            onClick={() => void handleSignOut()}
          >
            {isSigningOut ? "Signing out…" : "Sign out"}
          </button>
        </header>

        {showNavigation ? (
          <div className="mobile-navigation">
            <Navigation activeView={activeView} onNavigate={setActiveView} />
          </div>
        ) : null}

        <div className="workspace-content">
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
            <div hidden={activeView !== "practice"}>
              <Practice
                key={session.user.id}
                apiUrl={apiUrl}
                token={session.access_token}
                userId={session.user.id}
                defaultModel={savedSettings?.defaultAiModel ?? "gpt-5.4-mini"}
              />
            </div>
          ) : null}

          <div hidden={isLoading || loadFailed || isOnboarding || activeView !== "coach"}>
            <Coach
              key={session.user.id}
              apiUrl={apiUrl}
              token={session.access_token}
              userId={session.user.id}
              defaultModel={savedSettings?.defaultAiModel ?? "gpt-5.4-mini"}
              onReviewMemory={() => {
                setFocusMemoryInferences(true);
                setActiveView("learning");
              }}
            />
          </div>

          {!isLoading && !loadFailed && !isOnboarding && activeView === "history" ? (
            <AttemptHistory apiUrl={apiUrl} token={session.access_token} />
          ) : null}

          {!isLoading && !loadFailed && !isOnboarding && activeView === "learning" ? (
            <LearningContext
              apiUrl={apiUrl}
              token={session.access_token}
              focusInferences={focusMemoryInferences}
              onFocusHandled={() => setFocusMemoryInferences(false)}
            />
          ) : null}

          {!isLoading && !loadFailed && !isOnboarding && activeView === "external-ai" ? (
            <ExternalAiExport apiUrl={apiUrl} token={session.access_token} />
          ) : null}

          {!isLoading &&
          !loadFailed &&
          !isOnboarding &&
          activeView !== "settings" &&
          activeView !== "learning" &&
          activeView !== "external-ai" &&
          error !== undefined ? (
            <p className="auth-message" role="alert">
              {error}
            </p>
          ) : null}

          {!isLoading && !loadFailed && (isOnboarding || activeView === "settings") ? (
            <form
              id="practice-settings"
              className="settings-form"
              onSubmit={(event) => void handleSave(event)}
            >
              <div>
                <h2>{isOnboarding ? "Set up your practice" : "Practice settings"}</h2>
                <p className="settings-help">
                  These settings determine when a practice day starts and how much work is planned.
                </p>
              </div>

              <fieldset className="appearance-setting">
                <legend>Appearance</legend>
                <p className="settings-help">Choose how Practice++ looks on this browser.</p>
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
                Daily problem target
                <input
                  max="10"
                  min="1"
                  step="1"
                  type="number"
                  value={draft.dailyTarget}
                  onChange={(event) => setDraft({ ...draft, dailyTarget: event.target.value })}
                />
              </label>

              <label>
                Default attempt timer
                <span className="settings-help">Minutes for newly started attempts.</span>
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

              <OpenAIModelSelect
                value={draft.defaultAiModel}
                disabled={isSaving}
                onChange={(defaultAiModel) => setDraft({ ...draft, defaultAiModel })}
                label="Default OpenAI model"
                help="Used when you open Coach or Attempt tutor. Availability depends on your OpenAI API account."
              />

              <fieldset>
                <legend>Redo intervals</legend>
                <p className="settings-help">
                  Days until the next review, from most to least urgent.
                </p>
                <div className="interval-grid">
                  <label>
                    High
                    <input
                      max="90"
                      min="1"
                      step="1"
                      type="number"
                      value={draft.highInterval}
                      onChange={(event) => setDraft({ ...draft, highInterval: event.target.value })}
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
                      onChange={(event) => setDraft({ ...draft, lowInterval: event.target.value })}
                    />
                  </label>
                </div>
              </fieldset>

              {error === undefined ? null : (
                <p className="auth-message" role="alert">
                  {error}
                </p>
              )}

              {saved ? (
                <p className="save-message" role="status">
                  Settings saved.
                </p>
              ) : null}

              <button type="submit" disabled={isSaving}>
                {isSaving ? "Saving…" : isOnboarding ? "Start practicing" : "Save settings"}
              </button>
            </form>
          ) : null}
          {!isLoading && !loadFailed && !isOnboarding && activeView === "settings" ? (
            <BrowserKeySettings key={session.user.id} />
          ) : null}
        </div>
      </section>
    </main>
  );
}

interface NavigationProps {
  readonly activeView: ActiveView;
  readonly onNavigate: (view: ActiveView) => void;
}

const appearanceOptions: ReadonlyArray<{
  readonly label: string;
  readonly value: ThemePreference;
}> = [
  { label: "System default", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];

function Navigation({ activeView, onNavigate }: NavigationProps) {
  return (
    <nav className="workspace-navigation" aria-label="Primary navigation">
      {navigationItems.map((item) => (
        <button
          className="navigation-button"
          type="button"
          aria-current={activeView === item.view ? "page" : undefined}
          aria-controls={item.view === "settings" ? "practice-settings" : undefined}
          key={item.view}
          onClick={() => onNavigate(item.view)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}

function defaultDraft(): SettingsDraft {
  return {
    defaultAiModel: "gpt-5.4-mini",
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
    defaultAiModel: settings.defaultAiModel,
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
