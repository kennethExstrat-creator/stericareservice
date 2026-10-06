"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getAiReviewProgress } from "@/lib/inspections/ai/actions";

/**
 * While a second opinion is being written, asks every few seconds whether it
 * is done, and refreshes the page once it is: often at first (the mock and
 * webhooks answer in seconds), then more slowly (Claude can take minutes).
 * Waits while the tab is hidden. Renders nothing.
 */
export function ReviewPoller({ inspectionId, pendingIds }: { inspectionId: string; pendingIds: readonly string[] }) {
  const router = useRouter();
  const watching = pendingIds.join(",");

  useEffect(() => {
    if (watching === "") return;
    const ids = watching.split(",");
    const started = Date.now();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      const elapsed = Date.now() - started;
      timer = setTimeout(tick, elapsed < 30_000 ? 2_000 : elapsed < 120_000 ? 5_000 : 15_000);
    };
    const tick = async () => {
      if (cancelled) return;
      if (document.visibilityState === "visible") {
        const progress = await getAiReviewProgress(inspectionId).catch(() => ({ ok: false }) as const);
        if (cancelled) return;
        if (progress.ok && ids.some((id) => !progress.pending.includes(id))) {
          router.refresh();
          return;
        }
      }
      schedule();
    };
    schedule();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [inspectionId, watching, router]);

  return null;
}
