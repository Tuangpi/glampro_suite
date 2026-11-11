import { Component, type ErrorInfo, type ReactNode } from "react";

import { AlertTriangle } from "@/components/icons";
import { captureUnexpectedError } from "@/lib/monitoring";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time failures anywhere below it and shows a recoverable
 * screen instead of a blank page. React only supports error boundaries as
 * class components.
 */
export default class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    captureUnexpectedError(error);
    console.error("Unhandled UI error", error, info.componentStack);
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-bg p-6">
        <div className="w-full max-w-lg rounded-card border border-line bg-surface p-8 text-center shadow-menu">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger/10 text-danger">
            <AlertTriangle className="text-2xl" aria-hidden />
          </div>

          <h1 className="text-xl">Something went wrong</h1>
          <p className="mt-2 text-sm text-ink-muted">
            The screen failed to load. Reloading usually clears it up.
          </p>

          <pre className="mt-4 max-h-32 overflow-auto rounded-md bg-surface-muted p-3 text-left text-xs text-ink-muted">
            {error.message}
          </pre>

          <div className="mt-6 flex justify-center gap-3">
            <button
              type="button"
              onClick={this.reset}
              className="h-control rounded-md border border-line px-5 text-sm font-medium text-ink transition hover:bg-surface-muted"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="h-control rounded-md bg-purple px-5 text-sm font-semibold text-white shadow-purple-btn transition hover:bg-purple-dark"
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
