import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { validateConfig } from "./config";
import { ErrorBoundary } from "./ErrorBoundary";
import "./styles.css";

function Root() {
  validateConfig();

  return <App />;
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
