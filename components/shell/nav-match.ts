/**
 * Which nav entry is current, from the URL. Pure functions with no nav config,
 * so client components (NavLink, SectionGate) import this and the list of
 * admin screens never ships to an inspector's browser.
 */

/**
 * `exact`: only this path. `prefix`: this path and everything below it
 * (`/inspections` covers `/inspections/new`, never `/inspectionsfoo`).
 */
export type NavMatch = "exact" | "prefix";

export type NavTarget = { href: string; match: NavMatch };

/** "/admin/" and "/admin" are the same place; the root stays "/". */
export function normalizePath(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/** True when `pathname` is the page `link` points to, or inside it for a prefix link. */
export function isNavLinkActive(link: NavTarget, pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const path = normalizePath(pathname);
  const href = normalizePath(link.href);
  if (path === href) return true;
  return link.match === "prefix" && path.startsWith(href === "/" ? "/" : `${href}/`);
}

/**
 * The link's aria-current: "page" when it points at this very page, "true"
 * when this page is inside it (the Admin tab on /admin/users), else none.
 * Screen readers then never hear "current page" on two links at once.
 */
export function ariaCurrentFor(link: NavTarget, pathname: string | null | undefined): "page" | "true" | undefined {
  if (!isNavLinkActive(link, pathname)) return undefined;
  return normalizePath(pathname!) === normalizePath(link.href) ? "page" : "true";
}

/** True when `pathname` is one of `prefixes` or below it. */
export function isUnderAny(prefixes: readonly string[], pathname: string | null | undefined): boolean {
  return prefixes.some((href) => isNavLinkActive({ href, match: "prefix" }, pathname));
}
