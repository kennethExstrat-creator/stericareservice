import { describe, expect, it } from "vitest";
import { confirmsDeletion, deletionWord } from "./delete-user";

const ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("deletionWord", () => {
  it("asks for their UID, else their email on a project without UIDs, else their id", () => {
    expect(deletionWord({ id: ID, uid: "SC-0003", email: "olga@test.local" })).toBe("SC-0003");
    expect(deletionWord({ id: ID, uid: null, email: "olga@test.local" })).toBe("olga@test.local");
    // The page sends "" for an account without an address.
    expect(deletionWord({ id: ID, uid: null, email: "" })).toBe(ID);
    expect(deletionWord({ id: ID, uid: undefined, email: null })).toBe(ID);
  });
});

describe("confirmsDeletion", () => {
  it("takes the word as shown, in any case, with spaces around it", () => {
    expect(confirmsDeletion("SC-0003", "SC-0003")).toBe(true);
    // The iPad starts a field with a capital.
    expect(confirmsDeletion("Sc-0003", "SC-0003")).toBe(true);
    expect(confirmsDeletion("  sc-0003 ", "SC-0003")).toBe(true);
    expect(confirmsDeletion("Olga@Test.local", "olga@test.local")).toBe(true);
  });

  it("refuses anything else: nothing, part of it, another UID, the name", () => {
    for (const typed of ["", "   ", "SC-000", "SC-00033", "SC-0004", "SC 0003", "Olga Other"]) {
      expect(confirmsDeletion(typed, "SC-0003"), typed).toBe(false);
    }
  });

  it("never matches a blank word, so nothing typed can delete", () => {
    expect(confirmsDeletion("", "")).toBe(false);
    expect(confirmsDeletion(" ", "  ")).toBe(false);
  });
});
