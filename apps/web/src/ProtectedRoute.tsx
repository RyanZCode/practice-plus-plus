import { type ReactNode } from "react";

import { useAuth } from "./auth";
import { SignInPage } from "./SignInPage";

interface ProtectedRouteProps {
  readonly children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { retry, signOut, state } = useAuth();

  if (state.status === "loading") {
    return (
      <main className="auth-page" aria-live="polite">
        <p>{isAuthCallback() ? "Completing sign-in…" : "Loading your session…"}</p>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <h1>We couldn’t restore your session</h1>
          <p>{state.message}</p>
          <button type="button" onClick={retry}>
            Try again
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void signOut().catch(() => undefined)}
          >
            Sign in again
          </button>
          <p className="auth-help">If the session has expired, sign in again to continue.</p>
        </section>
      </main>
    );
  }

  if (state.status === "unauthenticated") {
    return <SignInPage />;
  }

  return children;
}

function isAuthCallback(): boolean {
  return window.location.pathname === "/auth/callback";
}
