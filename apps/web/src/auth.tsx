import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createBrowserKeyStore } from "./browserKey";

import {
  authErrorState,
  getAuthCallbackUrl,
  resolveAuthState,
  type AuthProviderName,
  type AuthState,
} from "./authState";

interface AuthContextValue {
  readonly browserKey: ReturnType<typeof createBrowserKeyStore>;
  readonly retry: () => void;
  readonly signIn: (provider: AuthProviderName) => Promise<void>;
  readonly signOut: () => Promise<void>;
  readonly state: AuthState;
}

interface AuthProviderProps {
  readonly children: ReactNode;
  readonly client: SupabaseClient;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children, client }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const [retryCount, setRetryCount] = useState(0);
  const [browserKey] = useState(() => createBrowserKeyStore(() => window.localStorage));

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => browserKey.handleStorageChange(event);
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [browserKey]);

  useEffect(() => {
    let active = true;
    let authEventReceived = false;
    function updateState(next: AuthState) {
      browserKey.setUser(next.status === "authenticated" ? next.session.user.id : null);
      setState(next);
    }
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      if (active) {
        authEventReceived = true;
        updateState(resolveAuthState(session));
      }
    });

    void client.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active || authEventReceived) {
          return;
        }

        updateState(error === null ? resolveAuthState(data.session) : authErrorState(error));
      })
      .catch((error: unknown) => {
        if (active && !authEventReceived) {
          updateState(authErrorState(error));
        }
      });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [browserKey, client, retryCount]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setRetryCount((current) => current + 1);
  }, []);

  const signIn = useCallback(
    async (provider: AuthProviderName) => {
      const { error } = await client.auth.signInWithOAuth({
        provider,
        options: { redirectTo: getAuthCallbackUrl(window.location.origin) },
      });

      if (error !== null) {
        throw error;
      }
    },
    [client],
  );

  const signOut = useCallback(async () => {
    browserKey.setUser(null);
    setState({ status: "unauthenticated" });
    const { error } = await client.auth.signOut({ scope: "local" });

    setState({ status: "unauthenticated" });

    if (error !== null) {
      throw error;
    }
  }, [browserKey, client]);

  const value = useMemo(
    () => ({ browserKey, retry, signIn, signOut, state }),
    [browserKey, retry, signIn, signOut, state],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (context === undefined) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return context;
}
