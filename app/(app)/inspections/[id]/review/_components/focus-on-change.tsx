"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Takes keyboard and screen-reader focus when `value` changes after the
 * first render. An approve or reopen refreshes the page and removes the
 * button that had focus; focus then lands on the new status instead of
 * falling back to the top of the document.
 */
export function FocusOnChange({
  value,
  labelledBy,
  className,
  children,
}: {
  value: string;
  /** Id of the heading that names this region. */
  labelledBy: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const shown = useRef(value);

  useEffect(() => {
    if (shown.current === value) return;
    shown.current = value;
    ref.current?.focus();
  }, [value]);

  return (
    <div ref={ref} role="region" aria-labelledby={labelledBy} tabIndex={-1} className={cn("outline-none", className)}>
      {children}
    </div>
  );
}
