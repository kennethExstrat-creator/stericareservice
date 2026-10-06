"use client";

// How a screen tells the shell it has work a shell link or Sign out would
// lose (./leave-guard.ts). Call it with a guard while there is such work, and
// with null when there is none:
//
//   useLeaveGuard(dirty ? async (reason) => {
//     await flushNow();                              // save what can be saved
//     return stillUnsaved() ? "Your changes to INS-2026-0001 are not saved yet." : null;
//   } : null);
//
// The guard may be a new function on every render: the latest one answers.
// It is registered once while non-null and removed when it turns null or the
// screen unmounts.
import { useEffect, useRef } from "react";
import { leaveGuards, type LeaveGuard } from "./leave-guard";

export function useLeaveGuard(guard: LeaveGuard | null | undefined): void {
  const latest = useRef(guard);
  useEffect(() => {
    latest.current = guard;
  });

  const active = Boolean(guard);
  useEffect(() => {
    if (!active) return;
    return leaveGuards.register((reason) => latest.current?.(reason) ?? null);
  }, [active]);
}
