"use client";

// Sign out, with the check before it (./sign-out-check.ts):
//
//   request()  checks; nothing found, it signs out at once; otherwise it
//              hands over the reasons (phase "asking") for the dialog.
//   confirm()  signs out anyway; stay() keeps the session.
//
// The Server Action is called by hand once the check is done. It ends this
// device's session and redirects to /login, which reaches here as a thrown
// redirect: it goes on to Next.js, and only then does the photo queue stop,
// so it does not carry over to whoever signs in next. A sign-out that did not
// reach the server keeps the user signed in, uploads running, and says so.
import { useCallback, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { signOut } from "@/lib/auth/actions";
import { leaveGuards } from "./leave-guard";
import {
  isNavigationSignal,
  loadPhotoQueue,
  reasonsBeforeSignOut,
  SIGN_OUT_FAILED,
  SIGN_OUT_FAILED_DETAIL,
  uploadsOnDevice,
} from "./sign-out-check";

export type SignOutPhase = "idle" | "checking" | "asking";

function stopUploads() {
  void loadPhotoQueue()
    .then((queue) => queue.stop())
    .catch(() => undefined);
}

export function useSignOut() {
  const [phase, setPhase] = useState<SignOutPhase>("idle");
  const [reasons, setReasons] = useState<string[]>([]);
  const [signingOut, startSigningOut] = useTransition();
  // The phase as of now, for handlers that run while a check is out.
  const phaseRef = useRef<SignOutPhase>("idle");
  const moveTo = useCallback((next: SignOutPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const signOutNow = useCallback(() => {
    startSigningOut(async () => {
      try {
        await signOut();
      } catch (error) {
        if (isNavigationSignal(error)) {
          stopUploads();
          throw error;
        }
        console.error("Sign out failed", error);
        toast.error(SIGN_OUT_FAILED, { description: SIGN_OUT_FAILED_DETAIL });
        return;
      }
      // Signed out without a redirect (not expected): the queue still lets go.
      stopUploads();
    });
  }, []);

  /** Checks, then signs out or asks. `onAsk` runs just before the dialog opens (the menu closes). */
  const request = useCallback(
    async (onAsk?: () => void) => {
      if (phaseRef.current !== "idle") return;
      moveTo("checking");
      const found = await reasonsBeforeSignOut({ uploads: () => uploadsOnDevice(), guards: leaveGuards });
      if (found.length === 0) {
        moveTo("idle");
        signOutNow();
        return;
      }
      setReasons(found);
      onAsk?.();
      moveTo("asking");
    },
    [moveTo, signOutNow],
  );

  const confirm = useCallback(() => {
    if (phaseRef.current === "asking") signOutNow();
  }, [signOutNow]);

  const stay = useCallback(() => moveTo("idle"), [moveTo]);

  return {
    phase,
    /** Why to ask, one sentence each, while phase is "asking". */
    reasons,
    /** The Server Action is on its way. */
    signingOut,
    /** Checking or signing out: Sign out waits. */
    busy: phase === "checking" || signingOut,
    request,
    confirm,
    stay,
  };
}
