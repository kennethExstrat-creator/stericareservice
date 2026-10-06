// The focus hand-off between the panel's controls and what replaces them
// (focus-handoff.tsx), and the answer a form gets when the server cannot be
// reached (unreachable.ts). The DOM side runs in e2e/export.
import { describe, expect, it, vi } from "vitest";
import { createFocusHandoff, HANDOFF_WAIT_MS } from "./focus-handoff";
import { unreachable, UNREACHABLE_MESSAGE } from "./unreachable";

function target() {
  return { focus: vi.fn() };
}

function setup({ free = true } = {}) {
  let time = 1_000;
  const state = { free };
  const handoff = createFocusHandoff({ now: () => time, focusIsFree: () => state.free });
  return {
    handoff,
    state,
    wait: (ms: number) => {
      time += ms;
    },
  };
}

describe("createFocusHandoff", () => {
  it("focuses a target that is already on the page at once", () => {
    const { handoff } = setup();
    const notice = target();
    handoff.register("ai-attempt", notice);
    handoff.request("ai-attempt");
    expect(notice.focus).toHaveBeenCalledTimes(1);
  });

  it("focuses a target when it arrives with the refresh, once", () => {
    const { handoff } = setup();
    handoff.request("ai-attempt");
    const notice = target();
    const remove = handoff.register("ai-attempt", notice);
    expect(notice.focus).toHaveBeenCalledTimes(1);
    // The next notice on the page (a later request) is not focused for this one.
    remove();
    const later = target();
    handoff.register("ai-attempt", later);
    expect(later.focus).not.toHaveBeenCalled();
  });

  it("does not focus a target that arrives too late, or another target", () => {
    const { handoff, wait } = setup();
    handoff.request("ai-attempt");
    const opinion = target();
    handoff.register("ai-opinion", opinion);
    expect(opinion.focus).not.toHaveBeenCalled();
    wait(HANDOFF_WAIT_MS + 1);
    const notice = target();
    handoff.register("ai-attempt", notice);
    expect(notice.focus).not.toHaveBeenCalled();
  });

  it("leaves focus where the user put it meanwhile", () => {
    const { handoff, state } = setup();
    handoff.request("ai-opinion");
    state.free = false;
    const opinion = target();
    handoff.register("ai-opinion", opinion);
    expect(opinion.focus).not.toHaveBeenCalled();
  });

  it("waits for the newer target while the one handing focus on still holds it", () => {
    // A newer opinion replaces the older one, in the same update that removes
    // the focused notice: the older opinion is still registered, focus is not
    // free yet, and the newer opinion arrives after the notice has gone.
    const { handoff, state } = setup();
    const older = target();
    const removeOlder = handoff.register("ai-opinion", older);
    state.free = false;
    handoff.request("ai-opinion");
    expect(older.focus).not.toHaveBeenCalled();
    state.free = true;
    removeOlder();
    const newer = target();
    handoff.register("ai-opinion", newer);
    expect(newer.focus).toHaveBeenCalledTimes(1);
    expect(older.focus).not.toHaveBeenCalled();
  });

  it("does not focus a target that has left the document", () => {
    const { handoff } = setup();
    const detached = { focus: vi.fn(), isConnected: false };
    handoff.register("ai-opinion", detached);
    handoff.request("ai-opinion");
    expect(detached.focus).not.toHaveBeenCalled();
  });

  it("forgets a target once it has left the page", () => {
    const { handoff } = setup();
    const first = target();
    const remove = handoff.register("ai-opinion", first);
    remove();
    handoff.request("ai-opinion");
    expect(first.focus).not.toHaveBeenCalled();
    const next = target();
    handoff.register("ai-opinion", next);
    expect(next.focus).toHaveBeenCalledTimes(1);
  });

  it("keeps the newer target when an older one is removed after it arrived", () => {
    const { handoff } = setup();
    const older = target();
    const removeOlder = handoff.register("ai-opinion", older);
    const newer = target();
    handoff.register("ai-opinion", newer);
    removeOlder();
    handoff.request("ai-opinion");
    expect(newer.focus).toHaveBeenCalledTimes(1);
    expect(older.focus).not.toHaveBeenCalled();
  });
});

describe("unreachable", () => {
  it("turns a rejected Server Action call into an error on the form", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(unreachable(new TypeError("Failed to fetch"))).toEqual({ status: "error", message: UNREACHABLE_MESSAGE });
    expect(UNREACHABLE_MESSAGE).toBe("Could not reach the server. Check the connection, then try again.");
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
