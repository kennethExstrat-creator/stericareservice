import { describe, expect, it } from "vitest";
import { DEFECTS_PATH } from "@/lib/admin/defects";
import { TEMPLATES_PATH } from "@/lib/admin/templates";
import {
  activeSection,
  ariaCurrentFor,
  hiddenSectionPaths,
  isHiddenFromRole,
  isNavLinkActive,
  NAV,
  navForRole,
  navLinks,
  normalizePath,
  plannedByPhase,
  type NavEntry,
  type NavSection,
} from "./nav";

const hrefs = (sections: readonly NavSection[]) => [
  ...sections.map((section) => section.tab.href),
  ...navLinks(sections).map((link) => link.href),
];

describe("navForRole", () => {
  it("gives an inspector the inspections list and nothing from admin", () => {
    const nav = navForRole("inspector");
    expect(nav.map((section) => section.key)).toEqual(["work"]);
    expect(nav[0].entries.map((entry) => entry.key)).toEqual(["inspections"]);
    expect(hrefs(nav).some((href) => href.startsWith("/admin"))).toBe(false);
  });

  it("gives an admin the inspections list and the admin section", () => {
    const nav = navForRole("admin");
    expect(nav.map((section) => section.key)).toEqual(["work", "admin"]);
    expect(nav[0].entries.map((entry) => entry.key)).toEqual(["inspections"]);

    const admin = nav[1];
    expect(admin.label).toBe("Admin");
    expect(admin.tab).toMatchObject({ label: "Admin", href: "/admin" });
    expect(admin.entries.map((entry) => [entry.key, entry.kind])).toEqual([
      ["overview", "link"],
      ["users", "link"],
      ["manufacturers", "link"],
      ["clients", "link"],
      ["defects", "link"],
      ["templates", "link"],
    ]);
  });

  it("has nothing planned: every admin screen of BUILD_SPEC 10 is built", () => {
    for (const role of ["inspector", "admin"] as const) {
      const entries = navForRole(role).flatMap((section) => section.entries);
      expect(entries.filter((entry) => entry.kind === "planned")).toEqual([]);
    }
  });

  it("links every admin screen to its page", () => {
    const links = navLinks(navForRole("admin"));
    expect(links.map((link) => [link.label, link.href, link.match])).toEqual([
      ["Inspections", "/inspections", "prefix"],
      ["Overview", "/admin", "exact"],
      ["Users", "/admin/users", "prefix"],
      ["Manufacturers", "/admin/manufacturers", "prefix"],
      ["Clients", "/admin/clients", "prefix"],
      ["Defects", "/admin/defects", "prefix"],
      ["Templates", "/admin/templates", "prefix"],
    ]);
  });

  it("uses the paths the defects and template screens use themselves", () => {
    const byKey = new Map(navLinks(navForRole("admin")).map((link) => [link.key, link.href]));
    expect(byKey.get("defects")).toBe(DEFECTS_PATH);
    expect(byKey.get("templates")).toBe(TEMPLATES_PATH);
  });

  it("filters entries inside a section and drops sections left empty", () => {
    const fixture: NavSection[] = [
      {
        key: "mixed",
        label: "Mixed",
        tab: { label: "Mixed", href: "/mixed", match: "prefix", icon: "overview" },
        roles: ["inspector", "admin"],
        entries: [
          { kind: "link", key: "everyone", label: "Everyone", href: "/mixed", match: "exact", icon: "overview", roles: ["inspector", "admin"] },
          { kind: "link", key: "admins", label: "Admins", href: "/mixed/admins", match: "prefix", icon: "users", roles: ["admin"] },
        ],
      },
      {
        key: "admins-only-entries",
        label: "Hidden",
        tab: { label: "Hidden", href: "/hidden", match: "prefix", icon: "admin" },
        roles: ["inspector", "admin"],
        entries: [
          { kind: "planned", key: "later", label: "Later", icon: "templates", phase: "Phase 3", roles: ["admin"] },
        ],
      },
    ];

    const inspector = navForRole("inspector", fixture);
    expect(inspector.map((section) => section.key)).toEqual(["mixed"]);
    expect(inspector[0].entries.map((entry) => entry.key)).toEqual(["everyone"]);

    const admin = navForRole("admin", fixture);
    expect(admin.map((section) => section.key)).toEqual(["mixed", "admins-only-entries"]);
    expect(admin[0].entries.map((entry) => entry.key)).toEqual(["everyone", "admins"]);
  });

  it("does not change the shared config", () => {
    const before = JSON.stringify(NAV);
    navForRole("inspector");
    navForRole("admin");
    expect(JSON.stringify(NAV)).toBe(before);
  });
});

describe("hiddenSectionPaths", () => {
  it("names only the admin area for an inspector, and nothing for an admin", () => {
    expect(hiddenSectionPaths("inspector")).toEqual(["/admin"]);
    expect(hiddenSectionPaths("admin")).toEqual([]);
  });
});

describe("ariaCurrentFor", () => {
  const inspections = { href: "/inspections", match: "prefix" } as const;
  const adminTab = { href: "/admin", match: "prefix" } as const;
  const overview = { href: "/admin", match: "exact" } as const;
  const defects = { href: "/admin/defects", match: "prefix" } as const;
  const templates = { href: "/admin/templates", match: "prefix" } as const;

  it.each([
    [inspections, "/inspections", "page"],
    [inspections, "/inspections/", "page"],
    [inspections, "/inspections/new", "true"],
    [adminTab, "/admin", "page"],
    [adminTab, "/admin/users", "true"],
    [overview, "/admin", "page"],
    [overview, "/admin/users", undefined],
    [defects, "/admin/defects", "page"],
    [defects, "/admin/defects/labels", "true"],
    [templates, "/admin/templates", "page"],
    [templates, "/admin/templates/0b1c/edit", "true"],
    [templates, "/admin/defects", undefined],
    [inspections, "/admin", undefined],
    [inspections, null, undefined],
  ] as const)("%o on %s is %s", (link, pathname, expected) => {
    expect(ariaCurrentFor(link, pathname)).toBe(expected);
  });
});

describe("isHiddenFromRole", () => {
  it.each([
    ["/admin", true],
    ["/admin/", true],
    ["/admin/users", true],
    ["/admin/users/abc", true],
    ["/admin/anything-planned", true],
    ["/administration", false],
    ["/inspections", false],
    ["/inspections/new", false],
    ["/", false],
    ["/no-such-page", false],
  ] as const)("%s for an inspector: %s", (pathname, hidden) => {
    expect(isHiddenFromRole(pathname, "inspector")).toBe(hidden);
  });

  it("hides nothing from an admin", () => {
    for (const pathname of ["/admin", "/admin/users", "/inspections", "/"]) {
      expect(isHiddenFromRole(pathname, "admin")).toBe(false);
    }
  });

  it("hides nothing without a pathname", () => {
    expect(isHiddenFromRole(null, "inspector")).toBe(false);
  });
});

describe("plannedByPhase", () => {
  it("has nothing to announce while every screen is built", () => {
    for (const role of ["inspector", "admin"] as const) {
      expect(plannedByPhase(navForRole(role).flatMap((section) => section.entries))).toEqual([]);
    }
  });

  it("groups planned screens by phase, in order", () => {
    const entries: NavEntry[] = [
      { kind: "planned", key: "a", label: "A", icon: "templates", phase: "Phase 3", roles: ["admin"] },
      { kind: "link", key: "b", label: "B", href: "/b", match: "exact", icon: "users", roles: ["admin"] },
      { kind: "planned", key: "c", label: "C", icon: "templates", phase: "Later", roles: ["admin"] },
      { kind: "planned", key: "d", label: "D", icon: "templates", phase: "Phase 3", roles: ["admin"] },
    ];
    expect(plannedByPhase(entries)).toEqual([
      { phase: "Phase 3", labels: ["A", "D"] },
      { phase: "Later", labels: ["C"] },
    ]);
  });
});

describe("normalizePath", () => {
  it.each([
    ["/", "/"],
    ["", "/"],
    ["/admin/", "/admin"],
    ["/admin//", "/admin"],
    ["/inspections", "/inspections"],
  ])("%j is %j", (input, expected) => {
    expect(normalizePath(input)).toBe(expected);
  });
});

describe("isNavLinkActive", () => {
  const inspections = { href: "/inspections", match: "prefix" } as const;
  const overview = { href: "/admin", match: "exact" } as const;
  const users = { href: "/admin/users", match: "prefix" } as const;

  it.each([
    [inspections, "/inspections", true],
    [inspections, "/inspections/", true],
    [inspections, "/inspections/new", true],
    [inspections, "/inspections/0b1c/review", true],
    [inspections, "/inspectionsfoo", false],
    [inspections, "/", false],
    [inspections, "/admin", false],
    [overview, "/admin", true],
    [overview, "/admin/", true],
    [overview, "/admin/users", false],
    [users, "/admin/users", true],
    [users, "/admin/users/invite", true],
    [users, "/admin/usersettings", false],
    [users, "/admin", false],
  ] as const)("%o on %s is %s", (link, pathname, expected) => {
    expect(isNavLinkActive(link, pathname)).toBe(expected);
  });

  it("is never active without a pathname", () => {
    expect(isNavLinkActive(inspections, null)).toBe(false);
    expect(isNavLinkActive(inspections, undefined)).toBe(false);
    expect(isNavLinkActive(inspections, "")).toBe(false);
  });
});

describe("the current entry", () => {
  const admin = navForRole("admin");

  it.each([
    ["/inspections", "work", ["inspections"]],
    ["/inspections/new", "work", ["inspections"]],
    ["/admin", "admin", ["overview"]],
    ["/admin/users", "admin", ["users"]],
    ["/admin/users/abc", "admin", ["users"]],
    ["/admin/manufacturers", "admin", ["manufacturers"]],
    ["/admin/clients", "admin", ["clients"]],
    ["/admin/defects", "admin", ["defects"]],
    ["/admin/defects/labels", "admin", ["defects"]],
    ["/admin/defects/unmapped", "admin", ["defects"]],
    ["/admin/templates", "admin", ["templates"]],
    ["/admin/templates/0b1c", "admin", ["templates"]],
    ["/admin/templates/0b1c/edit", "admin", ["templates"]],
    ["/admin/settings", "admin", []],
    ["/", null, []],
    ["/login", null, []],
  ] as const)("on %s: tab %s, entries %j", (pathname, tab, entries) => {
    expect(activeSection(admin, pathname)?.key ?? null).toBe(tab);
    expect(
      navLinks(admin)
        .filter((link) => isNavLinkActive(link, pathname))
        .map((link) => link.key),
    ).toEqual(entries);
  });

  it("marks at most one tab and one sidebar entry for any path", () => {
    const paths = [
      "/",
      "/inspections",
      "/inspections/x",
      "/admin",
      "/admin/users",
      "/admin/users/x",
      "/admin/defects/labels",
      "/admin/templates/x/edit",
      "/admin/other",
    ];
    for (const role of ["inspector", "admin"] as const) {
      const nav = navForRole(role);
      for (const pathname of paths) {
        expect(nav.filter((section) => isNavLinkActive(section.tab, pathname)).length).toBeLessThanOrEqual(1);
        expect(navLinks(nav).filter((link) => isNavLinkActive(link, pathname)).length).toBeLessThanOrEqual(1);
      }
    }
  });
});
