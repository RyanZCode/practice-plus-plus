import type { PracticeSettings } from "@practice-plus-plus/contracts";
import { useEffect, useRef, useState } from "react";

import { AttemptHistory } from "../features/attempts/AttemptHistory";
import { Analytics } from "../features/analytics/Analytics";
import { authenticatedUserId } from "../features/auth/authState";
import { useAuth } from "../features/auth/auth";
import { ProtectedRoute } from "../features/auth/ProtectedRoute";
import { Coach } from "../features/coach/Coach";
import { LearningContext } from "../features/learning-context/LearningContext";
import { Practice } from "../features/practice/Practice";
import { ModelDiscoveryProvider } from "../features/settings/ModelDiscovery";
import {
  PracticeSettings as PracticeSettingsPage,
  type SettingsSection,
} from "../features/settings/PracticeSettings";
import { loadPracticeSettings } from "../features/settings/settingsApi";
import { clearTutorConversationsForUser } from "../features/tutor/tutorConversationStorage";
import { defaultOpenAiModel } from "../shared/aiSelection";
import { loadTheme, resolveTheme, saveTheme, type ThemePreference } from "../shared/theme";
import { NavigationIcon } from "./NavigationIcon";

interface AppProps {
  readonly apiUrl: string;
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
  const { signOut, state } = useAuth();
  const userId = authenticatedUserId(state);
  const accessToken = state.status === "authenticated" ? state.session.access_token : null;
  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;
  const [savedSettings, setSavedSettings] = useState<PracticeSettings | null>(null);
  const [error, setError] = useState<string>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("practice");
  const [settingsReturn, setSettingsReturn] = useState<{ view: ActiveView; label: string } | null>(
    null,
  );
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
    if (view === "settings") {
      setSettingsSection("practice");
      setSettingsReturn(null);
    }
    setActiveView(view);
    if (mobileMenuOpen) mobileMenuButtonRef.current?.focus();
    setMobileMenuOpen(false);
    setVisitedViews((views) => {
      if (views.has(view)) return views;
      return new Set([...views, view]);
    });
  }

  function openAiSettings(view: ActiveView, label: string): void {
    navigate("settings");
    setSettingsSection("ai");
    setSettingsReturn({ view, label });
  }

  const showNavigation = !isLoading && !loadFailed && !isOnboarding;

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
          {isLoading ? (
            <p className="settings-status" role="status">
              Loading practice settings…
            </p>
          ) : null}

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
                defaultModel={savedSettings?.defaultAiModel ?? defaultOpenAiModel}
                defaultReasoningEffort={savedSettings?.reasoningEffort ?? null}
                view={activeView === "problems" ? "problems" : "today"}
                settings={savedSettings!}
                onNavigate={navigate}
                onAiSetup={(workflow) =>
                  openAiSettings(
                    "practice",
                    workflow === "attempt" ? "Return to attempt" : "Back to Today",
                  )
                }
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
              defaultModel={savedSettings?.defaultAiModel ?? defaultOpenAiModel}
              defaultReasoningEffort={savedSettings?.reasoningEffort ?? null}
              onReviewMemory={() => {
                setFocusMemoryInferences(true);
                navigate("learning");
              }}
              onAiSetup={() => openAiSettings("coach", "Back to Coach")}
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

          {!isLoading && !loadFailed ? (
            <PracticeSettingsPage
              key={session.user.id}
              apiUrl={apiUrl}
              token={session.access_token}
              settings={savedSettings}
              visible={isOnboarding || activeView === "settings"}
              section={settingsSection}
              onSectionChange={setSettingsSection}
              themePreference={themePreference}
              onThemeChange={onThemeChange}
              onSaved={(settings) => {
                setSavedSettings(settings);
                setIsOnboarding(false);
              }}
              {...(settingsReturn
                ? {
                    onReturn: () => navigate(settingsReturn.view),
                    returnLabel: settingsReturn.label,
                  }
                : {})}
            />
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
