import { describe, expect, it } from "vitest";
import { leaveAnswer } from "./leave-answer";

const REF = "INS-2026-0001";

describe("leaveAnswer: what the capture screen tells the shell's links and Sign out", () => {
  it("lets the shell go when everything is saved, or saving has not started", () => {
    expect(leaveAnswer({ pending: false, localCopy: true }, "navigate", REF)).toBeNull();
    expect(leaveAnswer({ pending: false, localCopy: false }, "sign-out", REF)).toBeNull();
    expect(leaveAnswer(null, "sign-out", REF)).toBeNull();
  });

  it("lets a link go while this device keeps a copy of a change still on its way", () => {
    expect(leaveAnswer({ pending: true, localCopy: true }, "navigate", REF)).toBeNull();
  });

  it("asks before a link leaves a change that nothing on this device keeps", () => {
    expect(leaveAnswer({ pending: true, localCopy: false }, "navigate", REF)).toBe(
      "Your last changes to INS-2026-0001 are not saved yet, and this browser keeps no copy of them, so they would be lost.",
    );
  });

  it("asks before signing out while a change is only on this device, kept or not", () => {
    expect(leaveAnswer({ pending: true, localCopy: true }, "sign-out", REF)).toBe(
      "Your last changes to INS-2026-0001 are still only on this device. They are not saved while you are signed out: they are saved when you next sign in here and open the inspection.",
    );
    expect(leaveAnswer({ pending: true, localCopy: false }, "sign-out", REF)).toMatch(/keeps no copy of them/);
  });
});
