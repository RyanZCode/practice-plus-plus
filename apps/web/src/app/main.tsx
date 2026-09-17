import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { AuthProvider } from "../features/auth/auth";
import { readConfig } from "../shared/config";
import { ErrorBoundary } from "../shared/ErrorBoundary";
import { getSupabaseClient } from "../shared/supabase";
import { loadTheme, resolveTheme } from "../shared/theme";
import "./styles.css";

const colorSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
document.documentElement.dataset.theme = resolveTheme(
  loadTheme(window.localStorage),
  colorSchemeQuery.matches,
);

function Root() {
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
