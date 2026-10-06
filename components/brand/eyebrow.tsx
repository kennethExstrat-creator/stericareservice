import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The website's Eyebrow in its light tone: a small uppercase label above a
 * heading, optionally led by a short dash in the signature gradient.
 */
export function Eyebrow({
  children,
  dash = false,
  className,
}: {
  children: ReactNode;
  /** Lead with the gradient dash. For short, single-line labels. */
  dash?: boolean;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "text-xs font-bold tracking-[0.2em] text-brand-600 uppercase",
        dash && "inline-flex items-center gap-3",
        className,
      )}
    >
      {dash && <span aria-hidden className="h-0.5 w-6 shrink-0 rounded-full bg-gradient-brand" />}
      {children}
    </p>
  );
}
