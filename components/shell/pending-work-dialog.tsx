"use client";

// Asks before the shell takes the user away from work that is not safe yet:
// a page's unsaved changes (./leave-guard.ts) or, on Sign out, photos and
// files still waiting on this device. Each reason is one plain sentence.
// Staying is the default (it has the focus); going on is the second choice,
// in the destructive style. While going on runs (signing out), nothing
// closes the dialog. Sign out's request has a time limit (use-sign-out.ts);
// when it fails or runs out of time, the dialog stays with both choices.
import { TriangleAlertIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

type PendingWorkDialogProps = {
  open: boolean;
  /** Called with false when the user stays (Stay, Escape). */
  onOpenChange: (open: boolean) => void;
  title: string;
  /** What would be lost, one sentence each. */
  reasons: readonly string[];
  stayLabel: string;
  goLabel: string;
  onGo: () => void;
  /** Going on is under way: both buttons wait. */
  going?: boolean;
  goingLabel?: string;
  /** Where focus goes when the dialog closes, when it has no trigger to return to. */
  returnFocus?: () => HTMLElement | null;
};

export function PendingWorkDialog({
  open,
  onOpenChange,
  title,
  reasons,
  stayLabel,
  goLabel,
  onGo,
  going = false,
  goingLabel,
  returnFocus,
}: PendingWorkDialogProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && going) return;
        onOpenChange(next);
      }}
    >
      <AlertDialogContent
        data-slot="pending-work-dialog"
        onEscapeKeyDown={(event) => {
          if (going) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          const target = returnFocus?.();
          if (!target || !target.isConnected) return;
          event.preventDefault();
          target.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-warn-tint text-warn">
            <TriangleAlertIcon aria-hidden />
          </AlertDialogMedia>
          <AlertDialogTitle className="text-lg font-bold">{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground touch:text-base">
              {reasons.map((reason) => (
                <p key={reason}>{reason}</p>
              ))}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={going}>{stayLabel}</AlertDialogCancel>
          <Button type="button" variant="destructive" onClick={onGo} disabled={going} data-action="go">
            {going && <Spinner aria-hidden="true" />}
            {going ? (goingLabel ?? goLabel) : goLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
