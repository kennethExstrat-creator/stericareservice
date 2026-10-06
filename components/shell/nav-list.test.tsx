// Server-rendered markup of the three nav views: which link is current
// (aria-current "page" on this very page, "true" on the section it is in),
// and that planned screens are never links.
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { navForRole } from "./nav";
import { SectionNav, SidebarNav, TabNav } from "./nav-list";

function render(pathname: string, ui: ReactNode): string {
  return renderToStaticMarkup(<PathnameContext.Provider value={pathname}>{ui}</PathnameContext.Provider>);
}

/** Every link marked current, as [its text, its aria-current]. */
function currentLinks(html: string): [string, string][] {
  return [...html.matchAll(/<a [^>]*aria-current="([^"]+)"[^>]*>(.*?)<\/a>/g)].map((match) => [
    match[2].replace(/<[^>]+>/g, "").trim(),
    match[1],
  ]);
}

const linkHrefs = (html: string) => [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((match) => match[1]);

describe("SidebarNav", () => {
  it("marks the current page and nothing else", () => {
    const nav = navForRole("admin");
    expect(currentLinks(render("/admin/users", <SidebarNav sections={nav} />))).toEqual([["Users", "page"]]);
    expect(currentLinks(render("/admin", <SidebarNav sections={nav} />))).toEqual([["Overview", "page"]]);
    expect(currentLinks(render("/inspections", <SidebarNav sections={nav} />))).toEqual([["Inspections", "page"]]);
    expect(currentLinks(render("/somewhere-else", <SidebarNav sections={nav} />))).toEqual([]);
  });

  it("marks a parent entry current but not as the page itself", () => {
    const nav = navForRole("admin");
    expect(currentLinks(render("/inspections/new", <SidebarNav sections={nav} />))).toEqual([["Inspections", "true"]]);
    expect(currentLinks(render("/admin/users/abc", <SidebarNav sections={nav} />))).toEqual([["Users", "true"]]);
  });

  it("shows the Phase 3 screens to admins as text, not links", () => {
    const html = render("/admin", <SidebarNav sections={navForRole("admin")} />);
    expect(linkHrefs(html)).toEqual(["/inspections", "/admin", "/admin/users"]);
    for (const label of ["Manufacturers", "Clients", "Defects", "Templates"]) expect(html).toContain(label);
    expect(html).toContain("coming in</span>");
    expect(html).toContain("Phase 3");
  });

  it("shows an inspector no admin entries at all", () => {
    const html = render("/inspections", <SidebarNav sections={navForRole("inspector")} />);
    expect(linkHrefs(html)).toEqual(["/inspections"]);
    expect(html).not.toMatch(/Admin|Overview|Users|Manufacturers|Phase 3/);
  });

  it("is a labelled navigation landmark with a labelled admin group", () => {
    const html = render("/admin", <SidebarNav sections={navForRole("admin")} />);
    expect(html).toContain('<nav aria-label="Main"');
    expect(html).toContain('<ul aria-labelledby="sidebar-nav-admin"');
  });
});

describe("TabNav", () => {
  it("has one tab per section and marks the current section", () => {
    const nav = navForRole("admin");
    const html = render("/admin/users", <TabNav sections={nav} />);
    expect(linkHrefs(html)).toEqual(["/inspections", "/admin"]);
    // On /admin/users the tab is the section, not the page: "true", not "page".
    expect(currentLinks(html)).toEqual([["Admin", "true"]]);
    expect(currentLinks(render("/admin", <TabNav sections={nav} />))).toEqual([["Admin", "page"]]);
    expect(currentLinks(render("/inspections", <TabNav sections={nav} />))).toEqual([["Inspections", "page"]]);
  });

  it("gives an inspector the Inspections tab only", () => {
    const html = render("/inspections", <TabNav sections={navForRole("inspector")} />);
    expect(linkHrefs(html)).toEqual(["/inspections"]);
    expect(html).not.toContain("Admin");
  });

  it("keeps each label in its link when narrow windows show only the icon", () => {
    const html = render("/admin", <TabNav sections={navForRole("admin")} />);
    for (const label of ["Inspections", "Admin"]) {
      expect(html).toMatch(new RegExp(`<a [^>]*>.*?<span class="max-\\[30rem\\]:sr-only">${label}</span></a>`));
    }
  });
});

describe("SectionNav", () => {
  it("lists the admin pages, marks the current one and links only built screens", () => {
    const admin = navForRole("admin").find((section) => section.key === "admin")!;
    const html = render("/admin/users", <SectionNav section={admin} />);
    expect(html).toContain('aria-label="Admin"');
    expect(linkHrefs(html)).toEqual(["/admin", "/admin/users"]);
    expect(currentLinks(html)).toEqual([["Users", "page"]]);
    // One line for what is planned; screen readers hear "Coming in Phase 3: ...".
    expect(html).toContain('<span class="sr-only">Coming in Phase 3: </span>Manufacturers, Clients, Defects and Templates');
  });
});
