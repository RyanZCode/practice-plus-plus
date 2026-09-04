import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { AuthProvider } from "./auth";
import { readConfig } from "./config";
import { ErrorBoundary } from "./ErrorBoundary";
import { getSupabaseClient } from "./supabase";
import "./styles.css";

function Root() {
  const client = getSupabaseClient(readConfig());

  return (
    <AuthProvider client={client}>
      <App />
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
