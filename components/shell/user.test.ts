import { describe, expect, it } from "vitest";
import { initialsFor, toShellUser } from "./user";

describe("initialsFor", () => {
  it.each([
    ["Test Admin", "admin@test.local", "TA"],
    ["Kenneth", "kenneth@example.com", "K"],
    ["  ana  maria   lopez ", "ana@example.com", "AL"],
    ["Łukasz Żak", "lz@example.com", "ŁŻ"],
    [null, "inspector@test.local", "I"],
    ["", "e2e-shell@test.local", "E"],
    ["   ", "", "?"],
  ])("%j with %j is %j", (name, email, expected) => {
    expect(initialsFor(name, email)).toBe(expected);
  });
});

describe("toShellUser", () => {
  it("keeps only what the shell shows", () => {
    expect(toShellUser({ email: "admin@test.local", fullName: "Test Admin", role: "admin" })).toEqual({
      name: "Test Admin",
      email: "admin@test.local",
      role: "admin",
      roleLabel: "Admin",
      initials: "TA",
    });
  });

  it("falls back to the email when there is no name", () => {
    expect(toShellUser({ email: "inspector@test.local", fullName: "  ", role: "inspector" })).toMatchObject({
      name: "inspector@test.local",
      roleLabel: "Inspector",
      initials: "I",
    });
  });
});
