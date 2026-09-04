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

import {
  authErrorState,
  getAuthCallbackUrl,
  resolveAuthState,
  type AuthProviderName,
  type AuthState,
} from "./authState";

interface AuthContextValue {
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

  useEffect(() => {
    let active = true;
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      if (active) {
        setState(resolveAuthState(session));
      }
    });

    void client.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) {
          return;
        }

        setState(error === null ? resolveAuthState(data.session) : authErrorState(error));
      })
      .catch((error: unknown) => {
        if (active) {
          setState(authErrorState(error));
        }
      });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [client, retryCount]);

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
    const { error } = await client.auth.signOut({ scope: "local" });

    setState({ status: "unauthenticated" });

    if (error !== null) {
      throw error;
    }
  }, [client]);

  const value = useMemo(() => ({ retry, signIn, signOut, state }), [retry, signIn, signOut, state]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (context === undefined) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return context;
}
