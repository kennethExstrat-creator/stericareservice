// Server-rendered markup of the three nav views: which link is current
// (aria-current "page" on this very page, "true" on the section it is in),
// and that a planned screen is never a link.
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { navForRole, type NavSection } from "./nav";
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

const ADMIN_PAGES = [
  "/admin",
  "/admin/users",
  "/admin/manufacturers",
  "/admin/clients",
  "/admin/defects",
  "/admin/ai",
];

/** A section with a screen still to come, as Kenneth might add one: the nav shows it, never links it. */
const WITH_PLANNED: NavSection = {
  key: "admin",
  label: "Admin",
  tab: { label: "Admin", href: "/admin", match: "prefix", icon: "admin" },
  roles: ["admin"],
  entries: [
    { kind: "link", key: "overview", label: "Overview", href: "/admin", match: "exact", icon: "overview", roles: ["admin"] },
    { kind: "planned", key: "reports", label: "Reports", icon: "overview", phase: "Later", roles: ["admin"] },
    { kind: "planned", key: "trends", label: "Trends", icon: "defects", phase: "Later", roles: ["admin"] },
  ],
};

describe("SidebarNav", () => {
  it("marks the current page and nothing else", () => {
    const nav = navForRole("admin");
    expect(currentLinks(render("/admin/users", <SidebarNav sections={nav} />))).toEqual([["Users", "page"]]);
    expect(currentLinks(render("/admin", <SidebarNav sections={nav} />))).toEqual([["Overview", "page"]]);
    expect(currentLinks(render("/admin/defects", <SidebarNav sections={nav} />))).toEqual([["Defects", "page"]]);
    expect(currentLinks(render("/admin/ai", <SidebarNav sections={nav} />))).toEqual([["Steri-AI Settings", "page"]]);
    expect(currentLinks(render("/inspections", <SidebarNav sections={nav} />))).toEqual([["Inspections", "page"]]);
    expect(currentLinks(render("/somewhere-else", <SidebarNav sections={nav} />))).toEqual([]);
  });

  it("marks a parent entry current but not as the page itself", () => {
    const nav = navForRole("admin");
    expect(currentLinks(render("/inspections/new", <SidebarNav sections={nav} />))).toEqual([["Inspections", "true"]]);
    expect(currentLinks(render("/admin/users/abc", <SidebarNav sections={nav} />))).toEqual([["Users", "true"]]);
    expect(currentLinks(render("/admin/defects/labels", <SidebarNav sections={nav} />))).toEqual([["Defects", "true"]]);
  });

  it("links every admin screen, with nothing announced as coming", () => {
    const html = render("/admin", <SidebarNav sections={navForRole("admin")} />);
    expect(linkHrefs(html)).toEqual(["/inspections", ...ADMIN_PAGES]);
    expect(html).not.toContain("coming in");
  });

  it("shows a planned screen as text with its phase, not as a link", () => {
    const html = render("/admin", <SidebarNav sections={[WITH_PLANNED]} />);
    expect(linkHrefs(html)).toEqual(["/admin"]);
    expect(html).toMatch(/<span class="[^"]*">Reports<\/span><span class="sr-only">, coming in<\/span>/);
    expect(html).toContain("Later");
  });

  it("shows an inspector no admin entries at all", () => {
    const html = render("/inspections", <SidebarNav sections={navForRole("inspector")} />);
    expect(linkHrefs(html)).toEqual(["/inspections"]);
    expect(html).not.toMatch(/Admin|Overview|Users|Manufacturers|Clients|Defects|Steri-AI/);
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
    expect(currentLinks(render("/admin/defects/labels", <TabNav sections={nav} />))).toEqual([["Admin", "true"]]);
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
  const admin = navForRole("admin").find((section) => section.key === "admin")!;

  it("lists every admin page as a link and marks the current one", () => {
    const html = render("/admin/users", <SectionNav section={admin} />);
    expect(html).toContain('aria-label="Admin"');
    expect(linkHrefs(html)).toEqual(ADMIN_PAGES);
    expect(currentLinks(html)).toEqual([["Users", "page"]]);
    expect(html).not.toContain("Coming in");
  });

  it("keeps Defects current on the pages below it", () => {
    expect(currentLinks(render("/admin/defects/labels", <SectionNav section={admin} />))).toEqual([["Defects", "true"]]);
    expect(currentLinks(render("/admin/defects/unmapped", <SectionNav section={admin} />))).toEqual([["Defects", "true"]]);
  });

  it("gives planned screens one line per phase, never links", () => {
    const html = render("/admin", <SectionNav section={WITH_PLANNED} />);
    expect(linkHrefs(html)).toEqual(["/admin"]);
    // Screen readers hear "Coming in Later: Reports and Trends".
    expect(html).toContain('<span class="sr-only">Coming in Later: </span>Reports and Trends');
  });
});
