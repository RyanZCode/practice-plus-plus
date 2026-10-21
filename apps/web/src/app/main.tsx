import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { AuthProvider, DemoAuthProvider } from "../features/auth/auth";
import { demoApiUrl } from "../shared/apiFetch";
import { readConfig } from "../shared/config";
import { ErrorBoundary } from "../shared/ErrorBoundary";
import { getSupabaseClient } from "../shared/supabase";
import { loadTheme, resolveTheme } from "../shared/theme";
import { initializeErrorMonitoring } from "../shared/errorMonitoring";
import "./styles.css";

initializeErrorMonitoring(
  import.meta.env.VITE_ERROR_MONITORING_DSN,
  import.meta.env.VITE_APP_ENV,
  import.meta.env.VITE_APP_VERSION,
);
const colorSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
document.documentElement.dataset.theme = resolveTheme(
  loadTheme(window.localStorage),
  colorSchemeQuery.matches,
);

function Root() {
  if (window.location.pathname === "/demo") {
    return (
      <DemoAuthProvider>
        <App apiUrl={demoApiUrl} />
      </DemoAuthProvider>
    );
  }
  const config = readConfig();
  const client = getSupabaseClient(config);

  return (
    <AuthProvider client={client}>
      <App apiUrl={config.apiUrl} />
    </AuthProvider>
  );
}

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
);
