import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { useAuth } from "../auth/auth";
import { discoverModels, ModelDiscoveryError } from "./modelDiscoveryApi";

export type ModelDiscoveryStatus = "idle" | "loading" | "ready" | "empty" | "stale" | "error";

interface ModelDiscoveryValue {
  readonly models: readonly string[];
  readonly status: ModelDiscoveryStatus;
  readonly error?: string;
  readonly retry: () => void;
}

interface ModelDiscoveryProviderProps {
  readonly apiUrl: string;
  readonly children: ReactNode;
}

const emptyValue: ModelDiscoveryValue = {
  models: [],
  status: "idle",
  retry: () => undefined,
};

const ModelDiscoveryContext = createContext<ModelDiscoveryValue>(emptyValue);

export function ModelDiscoveryProvider({ apiUrl, children }: ModelDiscoveryProviderProps) {
  const { browserKey, state: authState } = useAuth();
  const token = authState.status === "authenticated" ? authState.session.access_token : null;
  const userId = authState.status === "authenticated" ? authState.session.user.id : null;
  const keyState = useSyncExternalStore(browserKey.subscribe, browserKey.getSnapshot);
  const [retryCount, setRetryCount] = useState(0);
  const [state, setState] = useState<ModelDiscoveryValue>(emptyValue);

  const retry = useCallback(() => setRetryCount((count) => count + 1), []);

  useEffect(() => {
    if (token === null || userId === null) {
      setState(emptyValue);
      return;
    }
    const apiKey = browserKey.getKey(userId);
    if (!keyState.hasKey || apiKey === "") {
      setState(emptyValue);
      return;
    }

    const controller = new AbortController();
    let active = true;
    setState((current) => ({ models: current.models, status: "loading", retry }));
    void discoverModels(apiUrl, token, apiKey, controller.signal)
      .then((result) => {
        if (!active) return;
        setState({
          models: result.models.map((model) => model.id),
          status: result.state === "EMPTY" ? "empty" : "ready",
          retry,
        });
      })
      .catch((reason: unknown) => {
        if (!active || controller.signal.aborted) return;
        const error = reason instanceof ModelDiscoveryError ? reason : undefined;
        const invalidCredentials = error?.kind === "INVALID_CREDENTIALS";
        setState((current) => ({
          models: invalidCredentials ? [] : current.models,
          status: invalidCredentials ? "error" : current.models.length > 0 ? "stale" : "error",
          ...(error?.message ? { error: error.message } : {}),
          retry,
        }));
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [apiUrl, browserKey, keyState, retry, retryCount, token, userId]);

  const value = useMemo(() => state, [state]);
  return <ModelDiscoveryContext.Provider value={value}>{children}</ModelDiscoveryContext.Provider>;
}

export function useModelDiscovery(): ModelDiscoveryValue {
  return useContext(ModelDiscoveryContext);
}
