import { useState } from "react";

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
        <h1>Practice++</h1>
        <p>Sign in to continue.</p>

        {error === undefined ? null : (
          <p className="auth-message" role="alert">
            {error}
          </p>
        )}

        <div className="auth-actions">
          <button
            type="button"
            disabled={pendingProvider !== undefined}
            onClick={() => void handleSignIn("github")}
          >
            {pendingProvider === "github" ? "Opening GitHub…" : "Continue with GitHub"}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={pendingProvider !== undefined}
            onClick={() => void handleSignIn("google")}
          >
            {pendingProvider === "google" ? "Opening Google…" : "Continue with Google"}
          </button>
        </div>
      </section>
    </main>
  );
}
