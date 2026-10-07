"use client";

// What a paste left out, on screen (BUILD_SPEC 8: a pasted column fills
// down): the values past the last cell or field of the run, listed as they
// were pasted, and the values from other spreadsheet columns where a run
// takes its first column only. The live region says it in short as the paste
// lands; this stays until the inspector dismisses it or pastes again, so the
// values can be placed by hand. Amber: nothing is wrong with what was stored.
// "box" sits under a field; "strip" runs across the foot of a grid or table
// frame, as MeasurementGrid's list of rejected entries does.
import { useId } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { leftOutMessages, type PasteLeftOut } from "./field-navigation";
import { StatusIcon } from "./status-icon";

type PasteNoticeProps = {
  leftOut: PasteLeftOut;
  variant?: "box" | "strip";
  /** Takes the notice away; the caller puts the focus back where the paste was made. */
  onDismiss: () => void;
  className?: string;
};

export function PasteNotice({ leftOut, variant = "box", onDismiss, className }: PasteNoticeProps) {
  const messagesId = useId();
  const messages = leftOutMessages(leftOut);
  if (messages.length === 0) return null;
  return (
    <div
      data-slot="paste-notice"
      data-variant={variant}
      className={cn(
        // A grid item across every column where the run's frame is a grid.
        "col-span-full flex items-start gap-2 bg-warn-tint text-sm text-warn touch:text-base",
        variant === "box" ? "rounded-lg border border-warn-border px-3 py-2" : "border-t border-warn-border px-3 py-1.5",
        className,
      )}
    >
      <StatusIcon status="warn" className="mt-0.5 size-4 shrink-0 touch:mt-1" />
      <div id={messagesId} className="min-w-0 flex-1 space-y-0.5 self-center">
        {messages.map((message) => (
          <p key={message}>{message}</p>
        ))}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-describedby={messagesId}
        onClick={onDismiss}
        className="-my-1 shrink-0 text-warn hover:bg-warn-border/40 hover:text-warn touch:-my-1.5 touch:text-base"
      >
        Dismiss
      </Button>
    </div>
  );
}
