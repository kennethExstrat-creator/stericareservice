// A card of Steri-AI Settings (General, Inspection Settings): an icon tile and
// the title, then the body. In a row of two, the cards match heights (the
// grid stretches them), so a body's last row can sit at the foot with mt-auto.
import type { LucideIcon } from "lucide-react";
import { useId, type ReactNode } from "react";

export function SectionCard({
  icon: Icon,
  title,
  children,
  "data-testid": testId,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  "data-testid"?: string;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="flex min-w-0 flex-col gap-5 rounded-xl bg-card p-5 shadow-sm ring-1 ring-border touch:p-6"
      data-testid={testId}
    >
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <Icon aria-hidden className="size-5" />
        </span>
        <h2 id={id} className="text-lg leading-tight font-bold text-foreground">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}
