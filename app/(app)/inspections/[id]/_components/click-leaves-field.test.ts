// When a click leaves the field being typed in on the capture screen, without
// the DOM: nodes are stand-ins that know what they contain. The DOM side
// (capture-screen.tsx's click listener) was checked in a browser.
import { describe, expect, it } from "vitest";
import { clickLeavesField, type ClickOnField, type ContainsLike } from "./click-leaves-field";

type Field = ClickOnField["field"];

function holding(...members: unknown[]): ContainsLike {
  const inside = new Set<unknown>(members);
  return { contains: (other) => inside.has(other) };
}

/** A focused field, with the popups it controls (aria-controls) while one is open. */
function field(controls: string | null = null): Field {
  return { contains: () => false, getAttribute: (name) => (name === "aria-controls" ? controls : null) };
}

const cell = { name: "the next row's field" };
const option = { name: "suggestion 1004" };
const submit = { name: "Submit" };
const menuItem = { name: "the account menu's Sign Out" };

const suggestions = holding(option);
const menu = holding(menuItem);
const byId = (id: string) => ({ "box-suggestions": suggestions, "account-menu": menu })[id] ?? null;

/** A click on `target` while `focused`, a field of the open page, has the focus. */
function click(target: unknown, { focused = field(), followsLink = false }: { focused?: Field; followsLink?: boolean } = {}) {
  return clickLeavesField({ panel: holding(focused, cell), field: focused, target, followsLink, byId });
}

describe("clickLeavesField (capture-screen.tsx, Leaving)", () => {
  it("keeps the field for a click in the open page, the forms' own business", () => {
    expect(click(cell)).toBe(false);
  });

  it("leaves it for a click outside the page (Submit, the shell) and for any link", () => {
    expect(click(submit)).toBe(true);
    expect(click(menuItem)).toBe(true);
    expect(click(cell, { followsLink: true })).toBe(true);
    expect(click(null)).toBe(true);
  });

  it("keeps it for a click in the suggestions it controls, drawn outside the page (14 October 2026)", () => {
    // Blurring here stored the digits typed ("100") and closed the list before the click filled in 1004.
    expect(click(option, { focused: field("box-suggestions") })).toBe(false);
    expect(click(option, { focused: field("other-list box-suggestions") })).toBe(false);
  });

  it("leaves it for a click in a popup the field does not control, or once its list has closed", () => {
    expect(click(menuItem, { focused: field("box-suggestions") })).toBe(true);
    expect(click(option, { focused: field() })).toBe(true);
    expect(click(option, { focused: field("gone") })).toBe(true);
    // A link in its popup still leaves it.
    expect(click(option, { focused: field("box-suggestions"), followsLink: true })).toBe(true);
  });

  it("does nothing while no field of the page has the focus", () => {
    expect(clickLeavesField({ panel: holding(cell), field: field(), target: submit, followsLink: true, byId })).toBe(false);
  });
});
