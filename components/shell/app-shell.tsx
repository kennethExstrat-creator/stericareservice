// The signed-in frame around every app page (BUILD_SPEC 8 and 10).
//
// Below 1280 px (iPad portrait 820, landscape 1180): a sticky top bar with
// the logo, one tab per section and the user menu. From 1280 px (xl): a left
// sidebar with the logo, the same nav as a list, and the user at the foot.
// Content sits on the mist ground, at most 1280 px wide (the website's
// container).
//
// The app runs full screen from the iPad home screen (viewport-fit=cover), so
// the bars pad themselves out of the status bar and home indicator areas.
// Sticky elements inside a page should stick below the top bar:
// `sticky top-(--shell-top)` (0 from 1280 px, where there is no top bar).
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { HOME_PATH } from "@/lib/auth/routes";
import { cn } from "@/lib/utils";
import { LOGO_TOUCH_TARGET } from "./logo-link";
import type { NavSection } from "./nav";
import { SidebarNav, TabNav } from "./nav-list";
import type { ShellUser } from "./user";
import { UserMenu } from "./user-menu";

export const MAIN_CONTENT_ID = "main-content";

type AppShellProps = {
  user: ShellUser;
  /** Already filtered for the user's role (navForRole). */
  nav: readonly NavSection[];
  children: ReactNode;
};

export function AppShell({ user, nav, children }: AppShellProps) {
  return (
    <div className="flex min-h-dvh flex-1 flex-col [--shell-top:calc(4rem_+_1px_+_env(safe-area-inset-top))] xl:flex-row xl:[--shell-top:0px]">
      <SkipLink />
      <Sidebar user={user} nav={nav} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar user={user} nav={nav} />
        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className={cn(
            "flex-1 outline-none",
            "pt-6 pr-[max(1.5rem,env(safe-area-inset-right))] pb-[calc(2.5rem_+_env(safe-area-inset-bottom))] pl-[max(1.5rem,env(safe-area-inset-left))]",
            "md:pt-8 xl:pt-10 xl:pr-[max(2.5rem,env(safe-area-inset-right))] xl:pl-10",
          )}
        >
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

function SkipLink() {
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      className={cn(
        "sr-only focus:not-sr-only focus:fixed focus:top-[calc(0.75rem_+_env(safe-area-inset-top))] focus:left-3 focus:z-50",
        "focus:rounded-full focus:bg-card focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-brand-700",
        "focus:shadow-md focus-ring",
      )}
    >
      Skip to content
    </a>
  );
}

/**
 * iPad and narrow windows: logo, section tabs, user menu.
 *
 * The tabs keep their width and the account name gives way when room runs
 * out (iPad mini portrait, Split View): it truncates, and below 640 px only
 * the avatar shows (user-menu.tsx), with the logo's mark in place of the
 * wordmark. Below 480 px (Slide Over) the tabs show their icons only
 * (nav-list.tsx). Nothing overlaps and the bar never scrolls sideways.
 */
function TopBar({ user, nav }: { user: ShellUser; nav: readonly NavSection[] }) {
  return (
    <header
      data-testid="shell-top-bar"
      className="sticky top-0 z-40 border-b border-border bg-card pt-[env(safe-area-inset-top)] xl:hidden"
    >
      <div className="flex h-16 items-center gap-4 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1.5rem,env(safe-area-inset-left))]">
        <Logo variant="horizontal" href={HOME_PATH} loading="eager" className={cn(LOGO_TOUCH_TARGET, "max-sm:hidden")} />
        {/* The mark is 29 px wide: padding takes its link to 44 px on touch, and the negative margin keeps the layout. */}
        <Logo variant="mark" href={HOME_PATH} className={cn(LOGO_TOUCH_TARGET, "touch:-mx-2 touch:px-2 sm:hidden")} />
        <span aria-hidden className="h-7 w-px shrink-0 bg-border" />
        <TabNav sections={nav} className="shrink-0" />
        <UserMenu user={user} variant="bar" />
      </div>
    </header>
  );
}

/** 1280 px and wider: the same nav as a list, the user at the foot. */
function Sidebar({ user, nav }: { user: ShellUser; nav: readonly NavSection[] }) {
  return (
    // The white column runs the full page height; its contents stick to the viewport.
    <div className="hidden w-64 shrink-0 border-r border-border bg-card xl:block">
      <header data-testid="shell-sidebar" className="sticky top-0 flex h-dvh flex-col pt-[env(safe-area-inset-top)]">
        <div className="flex h-16 shrink-0 items-center px-5">
          <Logo variant="horizontal" href={HOME_PATH} loading="eager" className={LOGO_TOUCH_TARGET} />
        </div>
        <SidebarNav sections={nav} className="flex-1 overflow-y-auto px-3 pt-4 pb-6" />
        <div className="shrink-0 border-t border-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <UserMenu user={user} variant="sidebar" />
        </div>
      </header>
    </div>
  );
}
