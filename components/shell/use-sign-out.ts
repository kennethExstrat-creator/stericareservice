"use client";

// Sign out, with the check before it (./sign-out-check.ts):
//
//   request()  checks; nothing found, it signs out at once; otherwise it
//              hands over the reasons (phase "asking") for the dialog.
//   confirm()  signs out anyway; stay() keeps the session.
//
// The Server Action is called by hand once the check is done. It ends this
// device's session and redirects to /login, which Next.js follows by itself;
// the photo queue then stops, so it does not carry over to whoever signs in
// next.
//
// Signing out is plain state, not a transition. While the action runs, the
// router's own transition waits for the server, and React would hold a
// transition of ours with it, so its pending state could not end before the
// server answered. With plain state the page comes back after
// SIGN_OUT_TIMEOUT_MS without an answer, and when the sign-out fails. The
// user keeps their session and their uploads, and a toast says what happened.
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { signOut } from "@/lib/auth/actions";
import { LOGIN_PATH } from "@/lib/auth/routes";
import { leaveGuards } from "./leave-guard";
import {
  loadPhotoQueue,
  reasonsBeforeSignOut,
  sendSignOut,
  SIGN_OUT_FAILED,
  SIGN_OUT_FAILED_DETAIL,
  SIGN_OUT_SLOW,
  SIGN_OUT_SLOW_DETAIL,
  uploadsOnDevice,
} from "./sign-out-check";

export type SignOutPhase = "idle" | "checking" | "asking";

/**
 * Once signed out, how long Next.js has to show /login (outside the shell)
 * before the page goes there in full. A Back press while the request ran
 * drops the redirect, and the session has ended all the same.
 */
const LANDING_TIMEOUT_MS = 5_000;

function stopUploads() {
  void loadPhotoQueue()
    .then((queue) => queue.stop())
    .catch(() => undefined);
}

export function useSignOut() {
  const [phase, setPhase] = useState<SignOutPhase>("idle");
  const [reasons, setReasons] = useState<string[]>([]);
  const [signingOut, setSigningOut] = useState(false);
  // The phase as of now, for handlers that run while a check is out.
  const phaseRef = useRef<SignOutPhase>("idle");
  /** A sign-out is on its way: one at a time. */
  const sending = useRef(false);
  /** Still on screen: /login is outside the shell, so the shell going means the user got there. */
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const moveTo = useCallback((next: SignOutPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const signOutNow = useCallback(() => {
    if (sending.current) return;
    sending.current = true;
    setSigningOut(true);
    void sendSignOut(signOut, { onSignedOut: stopUploads }).then((outcome) => {
      if (outcome === "signed-out") {
        // On its way to /login: the spinner stays until the page changes.
        window.setTimeout(() => {
          if (mounted.current) window.location.assign(LOGIN_PATH);
        }, LANDING_TIMEOUT_MS);
        return;
      }
      sending.current = false;
      setSigningOut(false);
      if (outcome === "failed") toast.error(SIGN_OUT_FAILED, { description: SIGN_OUT_FAILED_DETAIL });
      else toast.error(SIGN_OUT_SLOW, { description: SIGN_OUT_SLOW_DETAIL });
    });
  }, []);

  /** Checks, then signs out or asks. `onAsk` runs just before the dialog opens (the menu closes). */
  const request = useCallback(
    async (onAsk?: () => void) => {
      if (phaseRef.current !== "idle" || sending.current) return;
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

  const stay = useCallback(() => {
    if (!sending.current) moveTo("idle");
  }, [moveTo]);

  return {
    phase,
    /** Why to ask, one sentence each, while phase is "asking". */
    reasons,
    /** The Server Action is on its way (at most SIGN_OUT_TIMEOUT_MS, unless it signed out). */
    signingOut,
    /** Checking or signing out: Sign out waits. */
    busy: phase === "checking" || signingOut,
    request,
    confirm,
    stay,
  };
}
