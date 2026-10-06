"use client";

// Last resort: an error in the root layout. This replaces the whole document,
// so it brings its own <html>, <body> and styles. The root layout's fonts are
// not loaded here; the system face stands in.
import "./globals.css";
import { RotateCwIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { HOME_PATH } from "@/lib/auth/routes";

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    console.error(error);
    // As in components/shell/error-screen.tsx: say what happened, not <body>.
    titleRef.current?.focus();
  }, [error]);

  return (
    <html
      lang="en"
      className="h-full antialiased [--font-outfit:ui-sans-serif,system-ui,sans-serif] [--font-redhat:ui-sans-serif,system-ui,sans-serif]"
    >
      <body className="flex min-h-full flex-col bg-background font-sans text-foreground">
        <title>SteriCare QC could not load</title>
        <main className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
          <Logo variant="horizontal" loading="eager" />
          <h1
            ref={titleRef}
            tabIndex={-1}
            className="mt-10 text-3xl leading-tight font-bold tracking-tight text-balance outline-none"
          >
            The app could not load
          </h1>
          <p className="mt-3 max-w-md text-base text-pretty text-muted-foreground">
            Something went wrong on our side. Try again. If it keeps happening, tell your admin
            {error.digest ? " and quote the reference below" : ""}.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" onClick={() => retry()}>
              <RotateCwIcon aria-hidden />
              Try again
            </Button>
            {/*
              A plain link, not next/link: the root layout failed, so this loads
              the whole app afresh. The home-screen app has no address bar or
              Back button to fall back on.
            */}
            <Button asChild size="lg" variant="outline">
              <a href={HOME_PATH}>Go to inspections</a>
            </Button>
          </div>
          {error.digest && (
            <p className="mt-8 text-sm text-muted-foreground">
              Reference: <span className="font-mono text-foreground">{error.digest}</span>
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
