import type { ReactNode } from "react";
import { Eyebrow } from "@/components/brand/eyebrow";
import { cn } from "@/lib/utils";

// docs/DESIGN.md type scale: Display (Red Hat Display 800, 36/40) is the sign-in
// screen's own; the other cards, some with long titles, use the H1 page title
// (700, 30/36) like PageHeader.
const TITLE_SIZES = {
  display: "text-4xl leading-10 font-extrabold",
  title: "text-3xl leading-tight font-bold",
} as const;

/** Eyebrow, title and short explanation at the top of each sign-in card. */
export function AuthHeading({
  title,
  description,
  size = "title",
  titleId,
  describedBy,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** "display" for the short title of /login; "title" (H1) everywhere else. */
  size?: keyof typeof TITLE_SIZES;
  /** Lets a form move focus to the title when the card changes, e.g. after sending a reset link. */
  titleId?: string;
  /** What a screen reader reads after the title when focus lands on it. */
  describedBy?: string;
}) {
  return (
    <header className="space-y-2">
      <Eyebrow dash>SteriCare QC</Eyebrow>
      <h1
        id={titleId}
        tabIndex={titleId ? -1 : undefined}
        aria-describedby={describedBy}
        data-size={size}
        className={cn(TITLE_SIZES[size], "tracking-tight text-balance text-foreground outline-none")}
      >
        {title}
      </h1>
      {description && <div className="text-base text-pretty text-muted-foreground">{description}</div>}
    </header>
  );
}
