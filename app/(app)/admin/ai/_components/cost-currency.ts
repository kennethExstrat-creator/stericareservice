"use client";

// The currency Steri-AI Cost shows, as each viewer last chose it with the
// RM | USD switch (Kenneth, 13 October 2026: "give me currency toggle i can
// toggle on my own"), kept on the device per user, as the capture screen's
// choices are. The address carries the choice too (view-state.ts); this is
// what the cost view opens on next time (view-frame.tsx) and what Try It's
// cost follows (summary-try-it.tsx). Storage may be missing or refuse
// (private browsing): every read and write is in try/catch, and the view
// then opens on ringgit. The server and hydration see no choice; the first
// render after hydration reads it (useSyncExternalStore).
import { createContext, use, useSyncExternalStore } from "react";
import type { CostCurrency } from "@/lib/schemas/ai-usage";

const STORAGE_PREFIX = "stericare:ai-cost-currency:";

/** The signed-in admin's id (the view frame provides it): the choice is kept per user on the device. */
export const CostCurrencyViewer = createContext<string | null>(null);

function storageKey(viewerId: string | null): string | null {
  return viewerId === null ? null : `${STORAGE_PREFIX}${viewerId}`;
}

/** The currency the viewer last chose on this device; null when none is kept or storage refuses. */
export function readRememberedCurrency(viewerId: string | null): CostCurrency | null {
  const key = storageKey(viewerId);
  if (key === null) return null;
  try {
    const value = window.localStorage.getItem(key);
    return value === "myr" || value === "usd" ? value : null;
  } catch {
    return null;
  }
}

/** Keeps the viewer's choice for the next visit. */
export function rememberCurrency(viewerId: string | null, currency: CostCurrency): void {
  const key = storageKey(viewerId);
  if (key === null) return;
  try {
    window.localStorage.setItem(key, currency);
  } catch {
    // Blocked or full: the address still carries the choice, only the next visit opens on ringgit.
  }
}

/** Another tab's choice. */
function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/** The remembered currency: null on the server, while hydrating, and when none is kept. */
export function useRememberedCurrency(): CostCurrency | null {
  const viewerId = use(CostCurrencyViewer);
  return useSyncExternalStore(subscribe, () => readRememberedCurrency(viewerId), () => null);
}
