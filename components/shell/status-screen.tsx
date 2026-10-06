// Full-page messages: not found, errors. Plain words, one clear way back.
import Link from "next/link";
import { CompassIcon, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Eyebrow } from "@/components/brand/eyebrow";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { HOME_PATH } from "@/lib/auth/routes";
import { cn } from "@/lib/utils";

type StatusScreenProps = {
  icon: LucideIcon;
  /** Colour of the icon: the brand for "lost", red for "broken". */
  tone?: "brand" | "error";
  eyebrow: string;
  title: string;
  description: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  className?: string;
};

export function StatusScreen({
  icon: Icon,
  tone = "brand",
  eyebrow,
  title,
  description,
  actions,
  footer,
  className,
}: StatusScreenProps) {
  return (
    <section
      aria-labelledby="status-screen-title"
      className={cn("mx-auto flex w-full max-w-xl flex-col items-center py-12 text-center md:py-20", className)}
    >
      <span
        className={cn(
          "flex size-16 items-center justify-center rounded-2xl bg-card shadow-sm ring-1 ring-border",
          tone === "error" ? "text-destructive" : "text-brand-600",
        )}
      >
        <Icon aria-hidden className="size-8" />
      </span>
      <Eyebrow className="mt-8">{eyebrow}</Eyebrow>
      <h1
        id="status-screen-title"
        className="mt-3 text-3xl leading-tight font-bold tracking-tight text-balance text-foreground"
      >
        {title}
      </h1>
      <div className="mt-3 max-w-md text-base text-pretty text-muted-foreground">{description}</div>
      {actions && <div className="mt-8 flex flex-wrap items-center justify-center gap-3">{actions}</div>}
      {footer && <div className="mt-8 text-sm text-muted-foreground">{footer}</div>}
    </section>
  );
}

/**
 * For screens rendered outside the app shell (the root not-found and error
 * pages): the logo bar on top, the message centred on the mist ground.
 */
export function StandaloneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-1 flex-col">
      <header className="border-b border-border bg-card pt-[env(safe-area-inset-top)]">
        <div className="flex h-16 items-center pr-[max(1.5rem,env(safe-area-inset-right))] pl-[max(1.5rem,env(safe-area-inset-left))]">
          <Logo variant="horizontal" href={HOME_PATH} loading="eager" />
        </div>
      </header>
      <main
        id="main-content"
        className="flex flex-1 flex-col justify-center px-6 pb-[calc(2.5rem_+_env(safe-area-inset-bottom))]"
      >
        {children}
      </main>
    </div>
  );
}

/** The 404 message. Never says whether the page exists for someone else (/admin). */
export function NotFoundScreen() {
  return (
    <StatusScreen
      icon={CompassIcon}
      eyebrow="Error 404"
      title="Page not found"
      description="There is no page at this address. Check the link, or go back to your inspections."
      actions={
        <Button asChild size="lg">
          <Link href={HOME_PATH}>Go to inspections</Link>
        </Button>
      }
    />
  );
}
