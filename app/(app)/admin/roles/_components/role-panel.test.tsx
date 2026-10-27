// The role panel as it first draws, for each kind of role: a new one, a
// custom role with and without people, a built-in role, and the Admin role
// (read-only, every switch on). Each switch is named by its label and says
// why when it is locked. The sheet is drawn in place here (a portal draws
// nothing on the server); e2e/roles opens it in the browser.
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ADMIN_ONLY_NOTE, NEEDS_ALL_ACCESS, ROLE_MESSAGES, type RoleItem } from "@/lib/admin/roles";
import { ADMIN_ONLY, ADMIN_ONLY_INFO, PERMISSION_INFO, ROLE_ACCESS, ROLE_ACCESS_INFO } from "@/lib/auth/permissions";
import { radioNames, radiosIn, textOf } from "../../_components/radio-card.testing";

vi.mock("../actions", () => ({ createRole: vi.fn(), updateRole: vi.fn(), deleteRole: vi.fn() }));
vi.mock("@/components/ui/sheet", () => {
  const Part = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return { Sheet: Part, SheetContent: Part, SheetDescription: Part, SheetFooter: Part, SheetHeader: Part, SheetTitle: Part };
});

import { RolePanel } from "./role-panel";

/** What React draws for `<form action={fn}>` on the server: such a form is reset after every action. */
const FUNCTION_ACTION = "React form unexpectedly submitted";

const role = (overrides: Partial<RoleItem>): RoleItem => ({
  id: "10000000-0000-4000-8000-000000000009",
  builtIn: null,
  name: "QC Manager",
  description: "Approves the day's work.",
  access: "all",
  permissions: [],
  updatedAt: "2026-10-27T08:00:00.066067+00:00",
  people: 0,
  ...overrides,
});

const ADMIN = role({ id: "10000000-0000-4000-8000-000000000001", builtIn: "admin", name: "Admin", description: "Everything, including users and roles.", people: 1 });
const INSPECTOR = role({
  id: "10000000-0000-4000-8000-000000000003",
  builtIn: "inspector",
  name: "Inspector",
  description: "Inspects, and sees their own inspections.",
  access: "own",
  permissions: ["create_inspections", "delete_drafts", "export_reports", "ai_reading", "ai_summary"],
  people: 3,
});

function draw(item: RoleItem | null): string {
  return renderToStaticMarkup(
    <RolePanel
      open
      target={item ? { mode: "edit", id: item.id } : { mode: "create" }}
      item={item}
      onClose={() => {}}
      onDeleted={() => {}}
      returnFocus={() => {}}
    />,
  );
}

const ENTITIES: Readonly<Record<string, string>> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'" };
const decode = (text: string) => text.replace(/&(?:amp|lt|gt|quot|#x27);/g, (entity) => ENTITIES[entity]);
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The words of the element with this id (its icon and tags dropped), or null. */
function wordsOf(html: string, id: string): string | null {
  const match = new RegExp(`\\sid="${escape(id)}"[^>]*>(.*?)</(?:span|p|label)>`).exec(html);
  return match ? decode(match[1].replace(/<[^>]+>/g, "")).trim() : null;
}

function attributes(tag: string): Record<string, string> {
  return Object.fromEntries([...tag.matchAll(/\s([\w:-]+)="([^"]*)"/g)].map(([, name, value]) => [name, decode(value)]));
}

type SwitchView = { key: string; name: string | null; describedBy: string[]; checked: boolean; disabled: boolean };

/** Each switch in the order drawn: its permission, its name, what describes it and its state. */
function switchesIn(html: string): SwitchView[] {
  return [...html.matchAll(/<li\b[^>]*data-permission="([^"]+)"[^>]*>.*?(<button\b[^>]*role="switch"[^>]*>)/g)].map(
    ([, key, tag]) => {
      const switchAttributes = attributes(tag);
      return {
        key,
        name: textOf(html, switchAttributes["aria-labelledby"]),
        describedBy: (switchAttributes["aria-describedby"] ?? "").split(" ").map((id) => wordsOf(html, id) ?? `#${id}`),
        checked: switchAttributes["aria-checked"] === "true",
        disabled: "disabled" in switchAttributes,
      };
    },
  );
}

type ButtonView = { text: string; type?: string; disabled: boolean };

/** Each button's words (its icon dropped), type and whether it is disabled. */
function buttonsIn(html: string): ButtonView[] {
  return [...html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/g)].map(([, tag, inner]) => {
    const parsed = attributes(` ${tag}`);
    return { text: decode(inner.replace(/<[^>]+>/g, "")).trim(), type: parsed.type, disabled: "disabled" in parsed };
  });
}

/** The fields someone can type in: not hidden, and not the copies Radix draws for its radios and switches. */
function typeable(html: string): string[] {
  return [...html.matchAll(/<(?:input|textarea)\b(?![^>]*type="hidden")(?![^>]*aria-hidden="true")[^>]*>/g)].map(
    ([tag]) => attributes(tag).name ?? "",
  );
}

/** The value of each hidden input named `name`. */
function hidden(html: string, name: string): string[] {
  return [...html.matchAll(new RegExp(`<input type="hidden" name="${name}" value="([^"]*)"`, "g"))].map(([, value]) => decode(value));
}

/** Every switch in screen order: the screens, Users and Roles & Permissions, then the actions. */
const SWITCH_ORDER = [
  ...PERMISSION_INFO.filter((info) => info.group === "screens").map((info) => info.key),
  ...ADMIN_ONLY,
  ...PERMISSION_INFO.filter((info) => info.group === "actions").map((info) => info.key),
];
const NEEDS_ALL = new Set<string>(PERMISSION_INFO.filter((info) => info.needsAllAccess).map((info) => info.key));
const LABEL = new Map<string, string>([
  ...PERMISSION_INFO.map((info) => [info.key, info.label] as const),
  ...ADMIN_ONLY.map((key) => [key, ADMIN_ONLY_INFO[key].label] as const),
]);

describe("RolePanel", () => {
  it("adds a role: its own inspections to start with, nothing switched on, submitted by hand", () => {
    const html = draw(null);
    expect(html).toContain("Add Role");
    expect(html).toContain("Name the role, choose what its people see, and switch on what they may use.");
    expect(html).not.toContain(FUNCTION_ACTION);
    expect(typeable(html)).toEqual(["name", "description"]);
    expect(html).toContain("Description (Optional)");
    expect(hidden(html, "access")).toEqual(["own"]);
    expect(hidden(html, "permissions")).toEqual([]);
    expect(hidden(html, "id")).toEqual([""]);
    expect(html).not.toContain("Delete Role");
    expect(buttonsIn(html)).toContainEqual({ text: "Add Role", type: "submit", disabled: false });

    // Sees: three cards, each radio named for Chrome by its card, none locked.
    expect(radioNames(html)).toEqual(
      ROLE_ACCESS.map((access) => ({ name: ROLE_ACCESS_INFO[access].label, description: ROLE_ACCESS_INFO[access].description })),
    );
    expect(radiosIn(html).map((radio) => [radio.value, radio["aria-checked"], "disabled" in radio])).toEqual([
      ["own", "true", false],
      ["team", "false", false],
      ["all", "false", false],
    ]);
  });

  it("names every switch by its label, and locks those its access cannot use, saying why", () => {
    const switches = switchesIn(draw(null));
    expect(switches.map((entry) => entry.key)).toEqual(SWITCH_ORDER);
    for (const entry of switches) {
      expect(entry.name, entry.key).toBe(LABEL.get(entry.key));
      expect(entry.checked, entry.key).toBe(false);
    }
    const locked = switches.filter((entry) => entry.disabled).map((entry) => entry.key);
    expect(locked).toEqual(["users", "roles", "approve_inspections", "switch_steps", "ai_second_opinion"]);
    for (const entry of switches.filter((candidate) => NEEDS_ALL.has(candidate.key))) {
      expect(entry.describedBy.at(-1), entry.key).toBe(NEEDS_ALL_ACCESS);
    }
    // Users and Roles & Permissions: no switch gives them.
    for (const entry of switches.filter((candidate) => candidate.key === "users" || candidate.key === "roles")) {
      expect(entry.describedBy).toEqual([ADMIN_ONLY_INFO[entry.key as "users" | "roles"].description, ADMIN_ONLY_NOTE]);
    }
  });

  it("edits a custom role that sees everything: its switches as stored, and deleting offered while nobody has it", () => {
    const item = role({ permissions: ["dashboard", "approve_inspections", "export_reports"] });
    const html = draw(item);
    expect(html).toContain("Edit Role");
    expect(html).toContain("Nobody has this role yet.");
    expect(hidden(html, "id")).toEqual([item.id]);
    expect(hidden(html, "version")).toEqual([item.updatedAt]);
    expect(hidden(html, "access")).toEqual(["all"]);
    expect(hidden(html, "permissions")).toEqual(["dashboard", "approve_inspections", "export_reports"]);
    expect(radiosIn(html).map((radio) => [radio.value, radio["aria-checked"], "disabled" in radio])).toEqual([
      ["own", "false", false],
      ["team", "false", false],
      ["all", "true", false],
    ]);

    const switches = switchesIn(html);
    expect(switches.filter((entry) => entry.checked).map((entry) => entry.key)).toEqual([
      "dashboard",
      "approve_inspections",
      "export_reports",
    ]);
    expect(switches.filter((entry) => entry.disabled).map((entry) => entry.key)).toEqual(["users", "roles"]);
    expect(html).toContain("Nobody has this role, so it can be deleted.");
    expect(buttonsIn(html)).toContainEqual({ text: "Delete Role", type: "button", disabled: false });
    expect(buttonsIn(html)).toContainEqual({ text: "Save Changes", type: "submit", disabled: false });
  });

  it("locks what a custom role sees while people have it, and does not offer to delete it", () => {
    const html = draw(role({ access: "own", people: 3 }));
    expect(html).toContain("3 people have this role: changes apply to them at once.");
    const lock = "3 people have this role. Move them to another role to change this.";
    expect(html).toContain(lock);
    expect(radiosIn(html).every((radio) => "disabled" in radio)).toBe(true);
    // The fieldset is described by the reason, so a screen reader hears why its radios do not move.
    const fieldsetLock = /<fieldset[^>]*aria-describedby="([^"]+)"[^>]*>\s*<legend[^>]*>Sees<\/legend>/.exec(html)?.[1];
    expect(fieldsetLock && wordsOf(html, fieldsetLock)).toBe(lock);
    expect(html).toContain("3 people have this role, so it cannot be deleted. Move them to another role first.");
    expect(buttonsIn(html)).toContainEqual({ text: "Delete Role", type: "button", disabled: true });
  });

  it("keeps a built-in role's name and what it sees, and never offers to delete it", () => {
    const html = draw(INSPECTOR);
    expect(html).toContain("Edit Role");
    expect(typeable(html)).toEqual(["description"]);
    expect(hidden(html, "name")).toEqual(["Inspector"]);
    expect(html).toContain("Built-in roles keep their names.");
    expect(html).toContain("Built-in roles keep what they see.");
    expect(radiosIn(html).every((radio) => "disabled" in radio)).toBe(true);
    // Its description and switches change.
    expect(html).toMatch(/<textarea[^>]*name="description"[^>]*>Inspects, and sees their own inspections.<\/textarea>/);
    const switches = switchesIn(html);
    expect(switches.filter((entry) => entry.checked).map((entry) => entry.key)).toEqual([
      "create_inspections",
      "delete_drafts",
      "export_reports",
      "ai_reading",
      "ai_summary",
    ]);
    expect(switches.find((entry) => entry.key === "dashboard")?.disabled).toBe(false);
    expect(html).not.toContain("Delete Role");
    expect(buttonsIn(html)).toContainEqual({ text: "Save Changes", type: "submit", disabled: false });
  });

  it("shows the Admin role read-only: every switch on and locked, nothing to type, nothing to save", () => {
    const html = draw(ADMIN);
    expect(html).toContain("Admin Role");
    expect(html).toContain(ROLE_MESSAGES.adminRole);
    const switches = switchesIn(html);
    expect(switches.map((entry) => entry.key)).toEqual(SWITCH_ORDER);
    expect(switches.every((entry) => entry.checked && entry.disabled)).toBe(true);
    // Nothing explains a lock that the Admin role does not have.
    expect(html).not.toContain(NEEDS_ALL_ACCESS);
    expect(radiosIn(html).map((radio) => [radio.value, radio["aria-checked"], "disabled" in radio])).toEqual([
      ["own", "false", true],
      ["team", "false", true],
      ["all", "true", true],
    ]);
    expect(typeable(html)).toEqual([]);
    expect(html).toContain("Everything, including users and roles.");
    expect(buttonsIn(html).filter((button) => button.type === "submit")).toEqual([]);
    expect(buttonsIn(html)).toContainEqual({ text: "Close", type: "button", disabled: false });
    expect(html).not.toContain("Delete Role");
  });
});
