/**
 * The app's navigation (BUILD_SPEC 10): what each role sees and which entry
 * is current. Pure data and functions, no React, so the rules are unit-tested.
 * Server code only: the server filters by role, and client components use
 * ./nav-match, so this list never reaches the browser whole.
 *
 * Hiding an entry is not access control: every page checks the session
 * itself (lib/auth/session.ts), and /admin answers 404 to non-admins.
 */
import { HOME_PATH } from "@/lib/auth/routes";
import type { Enums } from "@/lib/supabase/database.types";
import { isNavLinkActive, isUnderAny, type NavMatch } from "./nav-match";

export { ariaCurrentFor, isNavLinkActive, normalizePath, type NavMatch } from "./nav-match";

export type UserRole = Enums<"user_role">;

/** Icons by name; components/shell/nav-icon.tsx draws them. */
export type NavIconName =
  | "inspections"
  | "admin"
  | "dashboard"
  | "users"
  | "roles"
  | "manufacturers"
  | "clients"
  | "defects"
  | "settings"
  | "ai";

export type NavLinkEntry = {
  kind: "link";
  key: string;
  label: string;
  href: string;
  match: NavMatch;
  icon: NavIconName;
  roles: readonly UserRole[];
};

/**
 * A screen that is planned but not built: shown, never linked. Every screen
 * of BUILD_SPEC 10 is built, so NAV has none today; the kind stays for the
 * next screen Kenneth wants admins to see coming.
 */
export type NavPlannedEntry = {
  kind: "planned";
  key: string;
  label: string;
  icon: NavIconName;
  /** When it arrives, as Kenneth's roadmap names it. */
  phase: string;
  roles: readonly UserRole[];
};

export type NavEntry = NavLinkEntry | NavPlannedEntry;

export type NavSection = {
  key: string;
  /** Heading above the entries in the sidebar; null for the first, untitled section. */
  label: string | null;
  /** The section's tab in the iPad top bar. */
  tab: { label: string; href: string; match: NavMatch; icon: NavIconName };
  roles: readonly UserRole[];
  entries: readonly NavEntry[];
};

const EVERYONE: readonly UserRole[] = ["inspector", "admin"];
const ADMINS: readonly UserRole[] = ["admin"];

export const ADMIN_PATH = "/admin";
export const ADMIN_USERS_PATH = "/admin/users";
/** Roles & Permissions: what each role sees and may do (migration 20261027150000). Only the built-in Admin role opens it. */
export const ADMIN_ROLES_PATH = "/admin/roles";
export const ADMIN_MANUFACTURERS_PATH = "/admin/manufacturers";
export const ADMIN_CLIENTS_PATH = "/admin/clients";
/** DEFECTS_PATH in lib/admin/defects.ts: the codes, with label mapping and unmapped labels below. */
export const ADMIN_DEFECTS_PATH = "/admin/defects";
/** General Settings: Supabase and the sign-in emails (the Steri-AI hand-offs are on Steri-AI Settings' General). */
export const ADMIN_SETTINGS_PATH = "/admin/settings";
/** Steri-AI Settings: General (the API key), Inspection Settings and Steri-AI Cost, by ?view= (docs/AI.md, "AI Settings"). */
export const ADMIN_AI_PATH = "/admin/ai";

export const NAV: readonly NavSection[] = [
  {
    key: "work",
    label: null,
    tab: { label: "Inspections", href: HOME_PATH, match: "prefix", icon: "inspections" },
    roles: EVERYONE,
    entries: [
      {
        kind: "link",
        key: "inspections",
        label: "Inspections",
        href: HOME_PATH,
        match: "prefix",
        icon: "inspections",
        roles: EVERYONE,
      },
    ],
  },
  {
    key: "admin",
    label: "Admin",
    tab: { label: "Admin", href: ADMIN_PATH, match: "prefix", icon: "admin" },
    roles: ADMINS,
    entries: [
      // The admin home (Kenneth, 27 October 2026: "the overview should be a
      // dashboard"). Exact, so it is not also current on /admin/users.
      { kind: "link", key: "dashboard", label: "Dashboard", href: ADMIN_PATH, match: "exact", icon: "dashboard", roles: ADMINS },
      // BUILD_SPEC 10's admin screens. Prefix: each stays current on the pages
      // below it (/admin/defects/labels). No Templates: every client uses the
      // one standard flow (Kenneth, 26 October 2026).
      { kind: "link", key: "users", label: "Users", href: ADMIN_USERS_PATH, match: "prefix", icon: "users", roles: ADMINS },
      // Kenneth, 27 October 2026: "build permission and module on off for each role". Shown to every
      // admin for now; the page itself answers 404 to anyone without the built-in Admin role.
      { kind: "link", key: "roles", label: "Roles & Permissions", href: ADMIN_ROLES_PATH, match: "prefix", icon: "roles", roles: ADMINS },
      { kind: "link", key: "manufacturers", label: "Manufacturers", href: ADMIN_MANUFACTURERS_PATH, match: "prefix", icon: "manufacturers", roles: ADMINS },
      { kind: "link", key: "clients", label: "Clients", href: ADMIN_CLIENTS_PATH, match: "prefix", icon: "clients", roles: ADMINS },
      { kind: "link", key: "defects", label: "Defects", href: ADMIN_DEFECTS_PATH, match: "prefix", icon: "defects", roles: ADMINS },
      // The system status the overview showed until it became the dashboard (Kenneth, 27 October 2026:
      // "these looks more like should be in general settings or AI settings"): Supabase and the sign-in
      // emails here, the Steri-AI hand-offs on Steri-AI Settings' General.
      { kind: "link", key: "settings", label: "General Settings", href: ADMIN_SETTINGS_PATH, match: "prefix", icon: "settings", roles: ADMINS },
      { kind: "link", key: "ai", label: "Steri-AI Settings", href: ADMIN_AI_PATH, match: "prefix", icon: "ai", roles: ADMINS },
    ],
  },
];

/** The sections and entries `role` may see, in display order. Sections left empty are dropped. */
export function navForRole(role: UserRole, nav: readonly NavSection[] = NAV): NavSection[] {
  return nav
    .filter((section) => section.roles.includes(role))
    .map((section) => ({ ...section, entries: section.entries.filter((entry) => entry.roles.includes(role)) }))
    .filter((section) => section.entries.length > 0);
}

/**
 * The paths of the sections `role` may not see ("/admin" for an inspector,
 * nothing for an admin). The shell answers them with a 404 (SectionGate);
 * the server works them out, so the browser only learns its own.
 */
export function hiddenSectionPaths(role: UserRole, nav: readonly NavSection[] = NAV): string[] {
  return nav.filter((section) => !section.roles.includes(role)).map((section) => section.tab.href);
}

/** True when `pathname` is inside a section `role` may not see: /admin and everything under it for an inspector. */
export function isHiddenFromRole(
  pathname: string | null | undefined,
  role: UserRole,
  nav: readonly NavSection[] = NAV,
): boolean {
  return isUnderAny(hiddenSectionPaths(role, nav), pathname);
}

/** The section whose tab is current, if any (the iPad top bar marks it). */
export function activeSection(sections: readonly NavSection[], pathname: string | null | undefined): NavSection | null {
  return sections.find((section) => isNavLinkActive(section.tab, pathname)) ?? null;
}

/** Every linked entry of the given sections, in display order. */
export function navLinks(sections: readonly NavSection[]): NavLinkEntry[] {
  return sections.flatMap((section) => section.entries.filter((entry) => entry.kind === "link"));
}

/** Planned entries grouped by the phase they arrive in, in display order. */
export function plannedByPhase(entries: readonly NavEntry[]): { phase: string; labels: string[] }[] {
  const byPhase = new Map<string, string[]>();
  for (const entry of entries) {
    if (entry.kind === "planned") byPhase.set(entry.phase, [...(byPhase.get(entry.phase) ?? []), entry.label]);
  }
  return [...byPhase].map(([phase, labels]) => ({ phase, labels }));
}
