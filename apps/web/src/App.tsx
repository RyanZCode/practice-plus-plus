import { practiceSettingsSchema, type PracticeSettings } from "@practice-plus-plus/contracts";
import { useEffect, useState, type FormEvent } from "react";

import { useAuth } from "./auth";
import { BrowserKeySettings } from "./BrowserKeySettings";
import { ProtectedRoute } from "./ProtectedRoute";
import { Practice } from "./Practice";
import { AttemptHistory } from "./AttemptHistory";
import { loadPracticeSettings, savePracticeSettings } from "./settingsApi";

interface AppProps {
  readonly apiUrl: string;
}

interface SettingsDraft {
  readonly dailyTarget: string;
  readonly highInterval: string;
  readonly lowInterval: string;
  readonly mediumInterval: string;
  readonly resetTime: string;
  readonly timeZone: string;
}

export function App({ apiUrl }: AppProps) {
  return (
    <ProtectedRoute>
      <AccountPage apiUrl={apiUrl} />
    </ProtectedRoute>
  );
}

function AccountPage({ apiUrl }: AppProps) {
  const { signOut, state } = useAuth();
  const [draft, setDraft] = useState<SettingsDraft>(() => defaultDraft());
  const [error, setError] = useState<string>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    if (window.location.pathname === "/auth/callback") {
      window.history.replaceState(null, "", "/");
    }
  }, []);

  useEffect(() => {
    if (state.status !== "authenticated") {
      return;
    }

    let active = true;
    setError(undefined);
    setLoadFailed(false);
    setIsLoading(true);

    void loadPracticeSettings(apiUrl, state.session.access_token)
      .then((settings) => {
        if (!active) {
          return;
        }

        setIsOnboarding(settings === null);
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
  }, [apiUrl, reloadCount, state]);

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
      setError("Check the timezone, reset time, target, and review interval order.");
      return;
    }

    setIsSaving(true);

    try {
      const settings = await savePracticeSettings(apiUrl, session.access_token, result.data);
      setDraft(toDraft(settings));
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
      await signOut();
    } catch (signOutError) {
      setError(errorMessage(signOutError));
      setIsSigningOut(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="account-card">
        <div className="account-heading">
          <div>
            <h1>Practice++</h1>
            <p className="account-email">
              {session.user.email === undefined ? "You’re signed in." : session.user.email}
            </p>
          </div>
          <div className="account-actions">
            {!isLoading && !loadFailed && !isOnboarding ? (
              <button
                className="text-button"
                type="button"
                aria-expanded={showHistory}
                onClick={() => {
                  setShowHistory((show) => !show);
                  setShowSettings(false);
                }}
              >
                {showHistory ? "Back to practice" : "Attempt history"}
              </button>
            ) : null}
            {!isLoading && !loadFailed && !isOnboarding ? (
              <button
                className="text-button"
                type="button"
                aria-expanded={showSettings}
                aria-controls="practice-settings"
                onClick={() => {
                  setShowSettings((show) => !show);
                  setShowHistory(false);
                }}
              >
                {showSettings ? "Back to practice" : "Practice settings"}
              </button>
            ) : null}
            <button
              className="text-button"
              type="button"
              disabled={isSigningOut}
              onClick={() => void handleSignOut()}
            >
              {isSigningOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>

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
          <div hidden={showSettings || showHistory}>
            <Practice apiUrl={apiUrl} token={session.access_token} />
          </div>
        ) : null}

        {!isLoading && !loadFailed && !isOnboarding && showHistory ? (
          <AttemptHistory apiUrl={apiUrl} token={session.access_token} />
        ) : null}

        {!isLoading && !loadFailed && !isOnboarding && !showSettings && error !== undefined ? (
          <p className="auth-message" role="alert">
            {error}
          </p>
        ) : null}

        {!isLoading && !loadFailed && (isOnboarding || showSettings) ? (
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

            <label>
              Timezone
              <input
                autoComplete="off"
                value={draft.timeZone}
                onChange={(event) => setDraft({ ...draft, timeZone: event.target.value })}
              />
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
                    onChange={(event) => setDraft({ ...draft, mediumInterval: event.target.value })}
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
        {!isLoading && !loadFailed && !isOnboarding && showSettings ? (
          <BrowserKeySettings key={session.user.id} />
        ) : null}
      </section>
    </main>
  );
}

function defaultDraft(): SettingsDraft {
  return {
    dailyTarget: "2",
    highInterval: "1",
    lowInterval: "7",
    mediumInterval: "3",
    resetTime: "04:00",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };
}

function toDraft(settings: PracticeSettings): SettingsDraft {
  return {
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
