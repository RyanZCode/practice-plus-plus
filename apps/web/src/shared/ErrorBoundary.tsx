import { Component, type ReactNode } from "react";
import { reportError } from "./errorMonitoring";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public override state: State = { hasError: false };

  public static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  public override componentDidCatch(): void {
    reportError("component");
  }

  public override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main className="error-page">
          <h1>Something went wrong</h1>
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </main>
      );
    }

    return this.props.children;
  }
}
