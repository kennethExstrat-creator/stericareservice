import type { ReactNode } from "react";
import { Eyebrow } from "@/components/brand/eyebrow";

/** Eyebrow, title and short explanation at the top of each sign-in card. */
export function AuthHeading({
  title,
  description,
  titleId,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Lets a form move focus to the title when the card changes, e.g. after sending a reset link. */
  titleId?: string;
}) {
  return (
    <header className="space-y-2">
      <Eyebrow dash>SteriCare QC</Eyebrow>
      <h1
        id={titleId}
        tabIndex={titleId ? -1 : undefined}
        className="text-3xl leading-tight font-bold tracking-tight text-balance text-foreground outline-none"
      >
        {title}
      </h1>
      {description && <div className="text-base text-pretty text-muted-foreground">{description}</div>}
    </header>
  );
}
