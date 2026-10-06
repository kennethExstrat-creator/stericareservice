// Leaving the editor with unsaved changes: which link clicks leave this page
// for another page of the app. The editor stops those and asks first, the
// shell's sidebar and top bar included. Links to other sites are left to the
// browser, which asks itself (beforeunload), and so are clicks that open a
// new tab or window, which leave this one as it is.

export type LinkClick = {
  /** The link's href, as written or resolved. */
  href: string;
  /** Its target attribute: "" for none. */
  target: string;
  /** Whether it has a download attribute. */
  download: boolean;
  /** MouseEvent.button: 0 for a plain click, a tap or Enter. */
  button: number;
  /** Meta, Ctrl, Shift or Alt held. */
  modified: boolean;
};

/**
 * Where a click on a link takes the admin inside the app (path, query and
 * hash), or null when it does not leave this page: another tab or window, a
 * download, another site, or a place on this same page.
 */
export function leavingTo(click: LinkClick, here: string): string | null {
  if (click.button !== 0 || click.modified || click.download) return null;
  if (click.target !== "" && click.target !== "_self") return null;
  let to: URL;
  let current: URL;
  try {
    current = new URL(here);
    to = new URL(click.href, current);
  } catch {
    return null;
  }
  if (to.origin !== current.origin || (to.protocol !== "http:" && to.protocol !== "https:")) return null;
  if (to.pathname === current.pathname && to.search === current.search) return null;
  return `${to.pathname}${to.search}${to.hash}`;
}
