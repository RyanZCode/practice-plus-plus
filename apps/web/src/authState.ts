import type { Session } from "@supabase/supabase-js";

export type AuthProviderName = "github" | "google";

export type AuthState =
  | { readonly status: "loading" }
  | { readonly status: "authenticated"; readonly session: Session }
  | { readonly status: "unauthenticated" }
  | { readonly status: "error"; readonly message: string };

export function resolveAuthState(session: Session | null): AuthState {
  return session === null ? { status: "unauthenticated" } : { status: "authenticated", session };
}

export function authErrorState(error: unknown): AuthState {
  const message = error instanceof Error ? error.message : "The session could not be restored.";

  return { status: "error", message };
}

export function getAuthCallbackUrl(origin: string): string {
  return new URL("/auth/callback", origin).toString();
}

export function getAuthCallbackError(search: string, hash: string): string | undefined {
  const searchParameters = new URLSearchParams(search);
  const hashParameters = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const error = searchParameters.get("error") ?? hashParameters.get("error");

  if (error === "access_denied") {
    return "Sign-in was canceled. You can try again.";
  }

  return (
    searchParameters.get("error_description") ??
    hashParameters.get("error_description") ??
    (error === null ? undefined : "Sign-in could not be completed. Please try again.")
  );
}
