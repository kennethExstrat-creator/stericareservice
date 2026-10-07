// What the capture screen tells the shell before one of the shell's links or
// Sign out takes the inspector away (components/shell/leave-guard.ts), once
// the field being typed has been left and the last change sent: one plain
// sentence when the change would otherwise be lost, or null to let the shell
// go. Pure, so the rule is tested without a browser.
//
// Leaving within the app is safe while this device keeps a copy: the screen
// sends what is waiting as it goes, and the copy is saved the next time the
// inspection opens here (docs/OFFLINE.md), as a reload or a closed tab
// already does (beforeunload asks only without a copy). Signing out is not:
// this device cannot send the copy until the same inspector signs in here
// again, so the shell asks, as it does for photos still on the device.
import type { LeaveReason } from "@/components/shell/leave-guard";

/** The autosave's state as the guard reads it (AutosaveSnapshot), null before saving has started. */
export type LeaveSnapshot = { readonly pending: boolean; readonly localCopy: boolean } | null;

export function leaveAnswer(snapshot: LeaveSnapshot, reason: LeaveReason, refNo: string): string | null {
  if (!snapshot?.pending) return null;
  if (!snapshot.localCopy) {
    return `Your last changes to ${refNo} are not saved yet, and this browser keeps no copy of them, so they would be lost.`;
  }
  if (reason === "sign-out") {
    return `Your last changes to ${refNo} are still only on this device. They are not saved while you are signed out: they are saved when you next sign in here and open the inspection.`;
  }
  return null;
}
