import { useEffect, useState } from "react";

import { useAuth } from "./auth";
import { ProtectedRoute } from "./ProtectedRoute";

export function App() {
  return (
    <ProtectedRoute>
      <AccountPage />
    </ProtectedRoute>
  );
}

function AccountPage() {
  const { signOut, state } = useAuth();
  const [error, setError] = useState<string>();
  const [isSigningOut, setIsSigningOut] = useState(false);

  useEffect(() => {
    if (window.location.pathname === "/auth/callback") {
      window.history.replaceState(null, "", "/");
    }
  }, []);

  if (state.status !== "authenticated") {
    return null;
  }

  async function handleSignOut(): Promise<void> {
    setError(undefined);
    setIsSigningOut(true);

    try {
      await signOut();
    } catch (signOutError) {
      setError(signOutError instanceof Error ? signOutError.message : "Sign-out failed.");
      setIsSigningOut(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="account-card">
        <h1>Practice++</h1>
        <p>
          {state.session.user.email === undefined
            ? "You’re signed in."
            : `Signed in as ${state.session.user.email}`}
        </p>
        {error === undefined ? null : (
          <p className="auth-message" role="alert">
            {error}
          </p>
        )}
        <button type="button" disabled={isSigningOut} onClick={() => void handleSignOut()}>
          {isSigningOut ? "Signing out…" : "Sign out"}
        </button>
      </section>
    </main>
  );
}
