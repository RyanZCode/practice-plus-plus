import type { Session } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  authErrorState,
  getAuthCallbackError,
  getAuthCallbackUrl,
  resolveAuthState,
} from "./authState";

describe("authentication helpers", () => {
  it("resolves authenticated and unauthenticated sessions", () => {
    const session = { access_token: "token" } as Session;

    expect(resolveAuthState(session)).toEqual({ status: "authenticated", session });
    expect(resolveAuthState(null)).toEqual({ status: "unauthenticated" });
  });

  it("keeps session restoration errors recoverable", () => {
    expect(authErrorState(new Error("Session expired"))).toEqual({
      status: "error",
      message: "Session expired",
    });
  });

  it("builds the configured OAuth callback URL", () => {
    expect(getAuthCallbackUrl("https://practice.example.com")).toBe(
      "https://practice.example.com/auth/callback",
    );
  });

  it("reads OAuth errors from query strings and fragments", () => {
    expect(getAuthCallbackError("?error=access_denied&error_description=Access+denied", "")).toBe(
      "Sign-in was canceled. You can try again.",
    );
    expect(getAuthCallbackError("", "#error=server_error")).toBe(
      "Sign-in could not be completed. Please try again.",
    );
    expect(getAuthCallbackError("", "")).toBeUndefined();
  });
});
