"use client";

// Contains a module's capture form that fails to load or crashes while it
// renders, so one module's bug never takes the screen (or the other
// sections) down. The data is safe: it is saved by the screen, not by the
// form. A form whose code did not arrive (no connection, load-failure.ts) is
// not a bug: a calm notice says the section opens once the connection is
// back, and it tries again by itself when the browser is online again. A
// form that crashed says so in red. "Try Again" asks the screen for the form
// afresh (onRetry: a new download, rendered by a new boundary).
import { Component, type ErrorInfo, type ReactNode } from "react";
import { CloudOffIcon, OctagonXIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sectionFailure } from "./load-failure";

type Props = {
  title: string;
  /** Shows the form afresh: a new download of its code, under a new boundary. Without it the boundary renders its children again. */
  onRetry?: () => void;
  children: ReactNode;
};
type State = { error: Error | null; online: boolean };

function browserOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

export class SectionErrorBoundary extends Component<Props, State> {
  state: State = { error: null, online: true };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error, online: browserOnline() };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[capture] the form for ${this.props.title} failed`, error, info.componentStack);
    // Back online, the form is asked for again by itself; offline, the notice says so.
    window.addEventListener("online", this.retry);
    window.addEventListener("offline", this.wentOffline);
  }

  componentWillUnmount() {
    this.stopListening();
  }

  private stopListening() {
    window.removeEventListener("online", this.retry);
    window.removeEventListener("offline", this.wentOffline);
  }

  private wentOffline = () => {
    this.setState({ online: false });
  };

  private retry = () => {
    this.stopListening();
    if (this.props.onRetry) this.props.onRetry();
    else this.setState({ error: null, online: browserOnline() });
  };

  render() {
    const { error, online } = this.state;
    if (!error) return this.props.children;
    const failure = sectionFailure(error, online);
    const tryAgain = (
      <Button type="button" variant="outline" size="sm" onClick={this.retry}>
        <RefreshCwIcon aria-hidden />
        Try Again
      </Button>
    );

    if (failure !== "crashed") {
      // Calm: nothing is wrong with the inspection, and nothing typed is lost.
      return (
        <div
          role="status"
          data-slot="section-not-loaded"
          data-failure={failure}
          className="flex flex-col items-start gap-3 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-foreground touch:text-base"
        >
          <p className="flex items-start gap-2">
            <CloudOffIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground touch:mt-1" />
            <span>
              <span className="font-semibold">
                {failure === "offline"
                  ? "This section opens once the connection is back."
                  : `The form for ${this.props.title} did not load.`}
              </span>{" "}
              {failure === "offline"
                ? "Nothing is lost."
                : "Nothing is lost: try again, or reload the page if it still does not open."}
            </span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {tryAgain}
            {failure === "not_loaded" && (
              <Button type="button" variant="outline" size="sm" onClick={() => window.location.reload()}>
                <RefreshCwIcon aria-hidden />
                Reload
              </Button>
            )}
          </div>
        </div>
      );
    }

    return (
      <div
        role="alert"
        data-slot="section-crashed"
        className="flex flex-col items-start gap-3 rounded-lg border border-fail-border bg-fail-tint px-4 py-3 text-sm text-fail touch:text-base"
      >
        <p className="flex items-start gap-2 font-semibold">
          <OctagonXIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          The form for {this.props.title} could not be shown.
        </p>
        <p className="text-foreground">
          What is already entered is kept. Try again, or carry on with another section and report this to a
          developer.
        </p>
        {tryAgain}
      </div>
    );
  }
}
