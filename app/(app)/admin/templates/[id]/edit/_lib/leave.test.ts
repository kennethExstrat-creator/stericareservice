// Which link clicks leave the editor for another page of the app, so it asks
// first with unsaved changes: the shell's links too (M1 of the editor review).
import { describe, expect, it } from "vitest";
import { leavingTo, type LinkClick } from "./leave";

const HERE = "https://qc.example.test/admin/templates/7c1e/edit";

function click(href: string, overrides: Partial<LinkClick> = {}): LinkClick {
  return { href, target: "", download: false, button: 0, modified: false, ...overrides };
}

describe("leavingTo", () => {
  it("catches a plain click on a link to another page of the app", () => {
    expect(leavingTo(click("https://qc.example.test/inspections"), HERE)).toBe("/inspections");
    expect(leavingTo(click("/admin/templates"), HERE)).toBe("/admin/templates");
    expect(leavingTo(click("/admin/templates/9d2f/edit?tab=json#top"), HERE)).toBe("/admin/templates/9d2f/edit?tab=json#top");
    expect(leavingTo(click("/admin/templates/7c1e/edit", { target: "_self" }), HERE)).toBeNull();
    expect(leavingTo(click("/admin/templates/7c1e/edit?tab=json"), HERE)).toBe("/admin/templates/7c1e/edit?tab=json");
  });

  it("lets a new tab, a download, another site or a place on this page go", () => {
    expect(leavingTo(click("/inspections", { target: "_blank" }), HERE)).toBeNull();
    expect(leavingTo(click("/inspections", { modified: true }), HERE)).toBeNull();
    expect(leavingTo(click("/inspections", { button: 1 }), HERE)).toBeNull();
    expect(leavingTo(click("/files/report.pdf", { download: true }), HERE)).toBeNull();
    // The browser asks about other sites itself (beforeunload).
    expect(leavingTo(click("https://supabase.com/dashboard"), HERE)).toBeNull();
    expect(leavingTo(click("mailto:qc@example.test"), HERE)).toBeNull();
    // The shell's skip link, and the page itself.
    expect(leavingTo(click("#main-content"), HERE)).toBeNull();
    expect(leavingTo(click(HERE), HERE)).toBeNull();
  });
});
