"use client";

// Contains a module's capture form that fails to load or crashes while it
// renders, so one module's bug never takes the screen (or the other
// sections) down. The data is safe: it is saved by the screen, not by the
// form. "Try again" renders the form afresh.
import { Component, type ErrorInfo, type ReactNode } from "react";
import { OctagonXIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  title: string;
  /** Before "Try again" renders the form again, e.g. to forget a failed download of its code. */
  onReset?: () => void;
  children: ReactNode;
};
type State = { error: Error | null };

export class SectionErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[capture] the form for ${this.props.title} failed`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            this.props.onReset?.();
            this.setState({ error: null });
          }}
        >
          <RefreshCwIcon aria-hidden />
          Try again
        </Button>
      </div>
    );
  }
}
