// Page opener: the website's Eyebrow (light tone, gradient dash) above a Red
// Hat Display title, with optional description and actions. Wrap a word of
// the title in <span className="text-gradient-brand"> for the signature accent.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Eyebrow } from "@/components/brand/eyebrow";

type PageHeaderProps = {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({ eyebrow, title, description, actions, className }: PageHeaderProps) {
  return (
    <header
      data-slot="page-header"
      className={cn("flex flex-col gap-4 md:flex-row md:items-end md:justify-between", className)}
    >
      <div className="min-w-0 space-y-2">
        {eyebrow && <Eyebrow dash>{eyebrow}</Eyebrow>}
        <h1 className="text-3xl leading-tight font-bold tracking-tight text-balance text-foreground">{title}</h1>
        {description && <div className="max-w-2xl text-base text-muted-foreground">{description}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
