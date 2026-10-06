"use client";

// Two devices changed the same inspection and this one had changes the
// server never saw (docs/OFFLINE.md, "Reload and conflicts"). Nothing is
// merged and nothing is lost silently: saving stops until the inspector
// picks which version to keep.
import { MonitorSmartphoneIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

const WHEN = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });

export function ConflictDialog({
  open,
  localChangedAt,
  onKeep,
}: {
  open: boolean;
  /** Device time (ms) of this device's last unsaved change. */
  localChangedAt: number | null;
  onKeep: (keep: "local" | "server") => void;
}) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent onEscapeKeyDown={(event) => event.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-warn-tint text-warn">
            <MonitorSmartphoneIcon aria-hidden />
          </AlertDialogMedia>
          <AlertDialogTitle className="text-lg font-bold">This inspection was changed on another device</AlertDialogTitle>
          <AlertDialogDescription>
            This device has changes that were not saved
            {localChangedAt !== null ? ` (last change ${WHEN.format(localChangedAt)})` : ""}, and someone saved
            other changes meanwhile. Choose which version to keep. The other one is replaced.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="sm:flex-col sm:items-stretch">
          <Button type="button" onClick={() => onKeep("local")} data-action="keep-local">
            Keep the changes on this device
          </Button>
          <Button type="button" variant="outline" onClick={() => onKeep("server")} data-action="keep-server">
            Use the version from the other device
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
