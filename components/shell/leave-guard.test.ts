import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHECK_FAILED,
  createLeaveGuards,
  createLeaveRequests,
  guardedDestination,
  leaveDestination,
  leaveGuards,
  leaveRequests,
  STILL_SAVING,
  type LinkClick,
} from "./leave-guard";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the leave guards", () => {
  it("are inactive with nothing registered, and ask nothing", async () => {
    const guards = createLeaveGuards();
    expect(guards.active()).toBe(false);
    expect(await guards.check("navigate")).toEqual([]);
  });

  it("collect what each guard says would be lost, in order, trimmed, without repeats", async () => {
    const guards = createLeaveGuards();
    guards.register(() => "  Your changes to INS-2026-0001 are not saved yet. ");
    guards.register(() => null);
    guards.register(async () => "Your changes to this draft are not saved yet.");
    guards.register(() => undefined);
    guards.register(() => "   ");
    guards.register(() => "Your changes to INS-2026-0001 are not saved yet.");
    expect(guards.active()).toBe(true);
    expect(await guards.check("navigate")).toEqual([
      "Your changes to INS-2026-0001 are not saved yet.",
      "Your changes to this draft are not saved yet.",
    ]);
  });

  it("tells each guard how the user is leaving", async () => {
    const guards = createLeaveGuards();
    const guard = vi.fn(() => null);
    guards.register(guard);
    await guards.check("navigate");
    await guards.check("sign-out");
    expect(guard.mock.calls).toEqual([["navigate"], ["sign-out"]]);
  });

  it("waits for a guard that saves first", async () => {
    const guards = createLeaveGuards();
    let saved = false;
    guards.register(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      saved = true;
      return null;
    });
    expect(await guards.check("navigate")).toEqual([]);
    expect(saved).toBe(true);
  });

  it("counts a guard that throws or rejects as work that may be lost", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const guards = createLeaveGuards();
    guards.register(() => {
      throw new Error("boom");
    });
    guards.register(async () => {
      throw new Error("bang");
    });
    expect(await guards.check("sign-out")).toEqual([CHECK_FAILED]);
    expect(error).toHaveBeenCalledTimes(2);
  });

  it("does not wait for ever: a guard still saving after the time limit counts as unsaved", async () => {
    const guards = createLeaveGuards();
    guards.register(() => new Promise<string | null>(() => undefined));
    guards.register(() => "Your changes to this draft are not saved yet.");
    const started = Date.now();
    expect(await guards.check("navigate", { timeoutMs: 20 })).toEqual([
      STILL_SAVING,
      "Your changes to this draft are not saved yet.",
    ]);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("removes a guard again, each registration on its own", async () => {
    const guards = createLeaveGuards();
    const guard = () => "Unsaved.";
    const first = guards.register(guard);
    const second = guards.register(guard);
    first();
    expect(guards.active()).toBe(true);
    expect(await guards.check("navigate")).toEqual(["Unsaved."]);
    second();
    second();
    expect(guards.active()).toBe(false);
    expect(await guards.check("navigate")).toEqual([]);
  });

  it("start empty for the page", () => {
    expect(leaveGuards.active()).toBe(false);
  });
});

describe("leaveDestination", () => {
  const HERE = "http://localhost:3000/admin/templates/abc/edit?tab=modules";
  const click = (overrides: Partial<LinkClick> = {}): LinkClick => ({
    href: "/inspections",
    target: "",
    download: false,
    button: 0,
    modified: false,
    ...overrides,
  });

  it.each([
    ["another page", click(), "/inspections"],
    ["a resolved href with a query and hash", click({ href: "http://localhost:3000/admin/users?x=1#top" }), "/admin/users?x=1#top"],
    ["the same page with another query", click({ href: "/admin/templates/abc/edit?tab=json" }), "/admin/templates/abc/edit?tab=json"],
    ["target _self", click({ target: "_self" }), "/inspections"],
  ])("follows %s", (_, input, expected) => {
    expect(leaveDestination(input, HERE)).toBe(expected);
  });

  it.each([
    ["a new tab", click({ target: "_blank" })],
    ["a modified click", click({ modified: true })],
    ["a middle click", click({ button: 1 })],
    ["a download", click({ download: true })],
    ["another site", click({ href: "https://supabase.com/dashboard" })],
    ["a mail link", click({ href: "mailto:qc@example.com" })],
    ["a place on this page", click({ href: "/admin/templates/abc/edit?tab=modules#main-content" })],
    ["an href that is not a URL", click({ href: "http://[::1" })],
  ])("leaves %s alone", (_, input) => {
    expect(leaveDestination(input, HERE)).toBeNull();
  });
});

describe("guardedDestination", () => {
  const HERE = "http://localhost:3000/inspections/abc";
  const link = { href: "/admin", target: "", download: false, button: 0, modified: false, defaultPrevented: false };
  const active = { active: () => true };
  const idle = { active: () => false };

  it("steps in only while a page has registered a guard", () => {
    expect(guardedDestination(link, HERE, active)).toBe("/admin");
    expect(guardedDestination(link, HERE, idle)).toBeNull();
  });

  it("leaves a click the page already stopped to the page", () => {
    expect(guardedDestination({ ...link, defaultPrevented: true }, HERE, active)).toBeNull();
  });

  it("leaves clicks that do not leave the page to the browser", () => {
    expect(guardedDestination({ ...link, modified: true }, HERE, active)).toBeNull();
    expect(guardedDestination({ ...link, href: "#main-content" }, HERE, active)).toBeNull();
  });
});

describe("the shell's taps while the guards answer", () => {
  /** Guards whose answer the test gives by hand. */
  function handAnswered() {
    let answer: (reasons: string[]) => void = () => undefined;
    const check = vi.fn(
      () =>
        new Promise<string[]>((resolve) => {
          answer = resolve;
        }),
    );
    return { guards: { check }, check, answer: (reasons: string[]) => answer(reasons) };
  }

  it("asks the guards once, about navigating, and answers with the tap", async () => {
    const { guards, check, answer } = handAnswered();
    const requests = createLeaveRequests<string>(guards);
    const asked = requests.ask({ to: "/admin", link: "Admin tab" });
    await vi.waitFor(() => expect(check).toHaveBeenCalledWith("navigate"));
    expect(requests.waiting()).toEqual({ to: "/admin", link: "Admin tab" });
    answer([]);
    expect(await asked).toEqual({ request: { to: "/admin", link: "Admin tab" }, reasons: [] });
    expect(requests.waiting()).toBeNull();
  });

  it("goes where the last tap chose: a later tap joins the check and changes the destination", async () => {
    const { guards, check, answer } = handAnswered();
    const requests = createLeaveRequests<string>(guards);
    const first = requests.ask({ to: "/admin/templates", link: "Templates" });
    const second = requests.ask({ to: "/admin/users", link: "Users" });
    const third = requests.ask({ to: "/inspections", link: "Inspections tab" });
    expect(await second).toBeNull();
    expect(await third).toBeNull();
    expect(requests.waiting()).toEqual({ to: "/inspections", link: "Inspections tab" });
    await vi.waitFor(() => expect(check).toHaveBeenCalled());
    answer(["Your changes to INS-2026-0001 are not saved yet."]);
    expect(await first).toEqual({
      request: { to: "/inspections", link: "Inspections tab" },
      reasons: ["Your changes to INS-2026-0001 are not saved yet."],
    });
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("commits the page first, once per check, before the guards are asked", async () => {
    const order: string[] = [];
    const requests = createLeaveRequests<string>({
      check: async () => {
        order.push("guards asked");
        return [];
      },
    });
    const before = vi.fn(async () => {
      order.push("field committed");
    });
    const asked = requests.ask({ to: "/admin", link: "Admin tab" }, before);
    await requests.ask({ to: "/admin/users", link: "Users" }, before);
    await asked;
    expect(order).toEqual(["field committed", "guards asked"]);
    expect(before).toHaveBeenCalledTimes(1);
  });

  it("starts a new check for a tap after the answer", async () => {
    const check = vi.fn(async () => []);
    const requests = createLeaveRequests<string>({ check });
    expect(await requests.ask({ to: "/admin", link: "Admin tab" })).not.toBeNull();
    expect(await requests.ask({ to: "/inspections", link: "Inspections tab" })).toEqual({
      request: { to: "/inspections", link: "Inspections tab" },
      reasons: [],
    });
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("start with none waiting on the page", () => {
    expect(leaveRequests.waiting()).toBeNull();
  });
});
