import { useState } from "react";
import { LegalLinks } from "../../shared/LegalLinks";

import { useAuth } from "./auth";
import { getAuthCallbackError, type AuthProviderName } from "./authState";

export function SignInPage() {
  const { signIn } = useAuth();
  const [pendingProvider, setPendingProvider] = useState<AuthProviderName>();
  const [error, setError] = useState<string | undefined>(() =>
    getAuthCallbackError(window.location.search, window.location.hash),
  );

  async function handleSignIn(provider: AuthProviderName): Promise<void> {
    setError(undefined);
    setPendingProvider(provider);

    try {
      await signIn(provider);
    } catch (signInError) {
      setError(
        signInError instanceof Error ? signInError.message : "Sign-in could not be started.",
      );
      setPendingProvider(undefined);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <img className="brand-mark" src="/practice-plus-plus.svg" alt="" />
        <h1>Sign in to Practice++</h1>
        <p className="auth-help">
          Plan technical-interview practice, track attempts, schedule reviews, and understand your
          progress. Optional AI coaching uses a provider you connect.
        </p>

        {error === undefined ? null : (
          <p className="auth-message" role="alert">
            {error}
          </p>
        )}

        <div className="auth-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={pendingProvider !== undefined}
            onClick={() => void handleSignIn("github")}
          >
            <svg className="auth-provider-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M12 .297a12 12 0 0 0-3.793 23.385c.6.111.82-.261.82-.577v-2.234c-3.338.726-4.043-1.416-4.043-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.09-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.835 2.807 1.305 3.492.998.108-.776.419-1.305.762-1.605-2.665-.303-5.467-1.334-5.467-5.931 0-1.31.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23a11.52 11.52 0 0 1 6.006 0c2.291-1.552 3.297-1.23 3.297-1.23.653 1.652.242 2.873.119 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.625-5.479 5.922.43.372.823 1.102.823 2.222v3.293c0 .319.216.694.825.576A12.001 12.001 0 0 0 12 .297Z"
              />
            </svg>
            {pendingProvider === "github" ? "Opening GitHub…" : "Continue with GitHub"}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={pendingProvider !== undefined}
            onClick={() => void handleSignIn("google")}
          >
            <svg className="auth-provider-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-1.99 3.02v2.51h3.23c1.89-1.74 2.98-4.3 2.98-7.36Z"
              />
              <path
                fill="#34A853"
                d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.23-2.51c-.9.6-2.05.96-3.39.96-2.6 0-4.81-1.76-5.6-4.12H3.06v2.59A10 10 0 0 0 12 22Z"
              />
              <path
                fill="#FBBC05"
                d="M6.4 13.92a6 6 0 0 1 0-3.84V7.49H3.06a10 10 0 0 0 0 9.02l3.34-2.59Z"
              />
              <path
                fill="#EA4335"
                d="M12 5.96c1.47 0 2.79.5 3.82 1.49l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.94 5.49l3.34 2.59C7.19 7.72 9.4 5.96 12 5.96Z"
              />
            </svg>
            {pendingProvider === "google" ? "Opening Google…" : "Continue with Google"}
          </button>
        </div>
        <div className="auth-divider">or</div>
        <a className="demo-entry secondary-button" href="/demo">
          Try demo
        </a>
        <p className="auth-help">Explore with sample data. No signup or API key needed.</p>
        <LegalLinks />
      </section>
    </main>
  );
}
