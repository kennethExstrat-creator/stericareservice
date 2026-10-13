// Whether a click leaves the field being edited on the capture screen's open
// page (capture-screen.tsx, "Leaving"): the screen then blurs the field
// before the click does its work, so a half-typed value is stored for its
// section first. A click inside the page is the forms' own business, unless
// it follows a link. So is a click in the popup the field itself controls
// (its aria-controls), such as a box/carton number's suggestions, which a
// portal draws outside the page: blurring the field there would store the
// digits typed so far and close the list before the suggestion clicked is
// filled in (14 October 2026). Pure over the few DOM calls it reads, so the
// rule is tested without a browser.

/** The part of a DOM node the rule reads. */
export interface ContainsLike {
  contains(other: unknown): boolean;
}

export type ClickOnField = {
  /** The open page. */
  panel: ContainsLike;
  /** The element with the focus. */
  field: ContainsLike & { getAttribute(name: string): string | null };
  /** What was clicked; null when it is no node. */
  target: unknown;
  /** The click follows a link (a[href]), in the page or out of it. */
  followsLink: boolean;
  /** document.getElementById. */
  byId: (id: string) => ContainsLike | null;
};

export function clickLeavesField({ panel, field, target, followsLink, byId }: ClickOnField): boolean {
  // Nothing on the page is being edited.
  if (!panel.contains(field)) return false;
  if (followsLink) return true;
  if (target !== null && panel.contains(target)) return false;
  // aria-controls is a list of ids.
  const controlled = (field.getAttribute("aria-controls") ?? "").split(/\s+/).filter(Boolean);
  return !controlled.some((id) => target !== null && byId(id)?.contains(target) === true);
}
