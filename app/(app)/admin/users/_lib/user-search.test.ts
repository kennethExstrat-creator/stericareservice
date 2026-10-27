import { describe, expect, it } from "vitest";
import type { TeamFilter } from "./team-filter";
import {
  isSearching,
  listSummary,
  matchingIds,
  MAX_SEARCH_LENGTH,
  noMatchMessage,
  phoneDigits,
  phoneSpellings,
  queryAfterViewChange,
  readSearch,
  uidSpellings,
  userSearchText,
  type SearchEntry,
} from "./user-search";

const PEOPLE = [
  { id: "olga", uid: "SC-0042", fullName: "Olga Óther", email: "olga@test.local", phone: "+60 12-345 6789" },
  { id: "ivan", uid: "SC-0420", fullName: "Ivan Inspector", email: "ivan@example.com", phone: "(03) 7788 1122" },
  { id: "ngan", uid: "SC-10000", fullName: "Ngan Boon Keat", email: "lead@test.local", phone: null },
  // Invited without a name, and from before UIDs.
  { id: "nobody", uid: null, fullName: null, email: "new@test.local", phone: null },
];

const ENTRIES: SearchEntry[] = PEOPLE.map((person) => ({ id: person.id, text: userSearchText(person) }));

/** Who a search finds, in the list's order; null for everyone. */
function found(query: string): string[] | null {
  const ids = matchingIds(ENTRIES, query);
  return ids ? ENTRIES.filter((entry) => ids.has(entry.id)).map((entry) => entry.id) : null;
}

const LINA: TeamFilter = { kind: "team", leadId: "lina", leadName: "Lina Lead" };

describe("the search on /admin/users", () => {
  it("finds someone by their UID, as shown or without the hyphen, in any case", () => {
    for (const query of ["SC-0042", "sc-0042", "SC0042", " SC-0042 "]) {
      expect(found(query), query).toEqual(["olga"]);
    }
    expect(found("SC-10000")).toEqual(["ngan"]);
    expect(found("sc10000")).toEqual(["ngan"]);
  });

  it("takes a UID typed without its zeros as the start of one, like every word searched", () => {
    expect(found("SC-42")).toEqual(["olga", "ivan"]); // SC-0042, and SC-0420 as it starts SC-42
    expect(found("sc420")).toEqual(["ivan"]);
    expect(found("SC-1")).toEqual(["ngan"]);
    // Part of a UID narrows as it is typed: every UID starts SC-.
    expect(found("SC-")).toEqual(["olga", "ivan", "ngan"]);
    expect(found("SC-00")).toEqual(["olga"]);
    expect(found("SC-04")).toEqual(["ivan"]);
    expect(found("042")).toEqual(["olga", "ivan"]);
  });

  it("finds someone by any part of their name or email, every word in any order, ignoring accents", () => {
    expect(found("olga")).toEqual(["olga"]);
    expect(found("other olga")).toEqual(["olga"]);
    expect(found("Boon keat")).toEqual(["ngan"]);
    expect(found("lead@test")).toEqual(["ngan"]);
    expect(found("example.com")).toEqual(["ivan"]);
    expect(found("new@")).toEqual(["nobody"]);
    expect(found("test.local")).toEqual(["olga", "ngan", "nobody"]);
    expect(found("olga ivan")).toEqual([]);
    expect(found("SC-0042 ivan")).toEqual([]);
  });

  it("finds someone by their phone number, whatever spaces, brackets or hyphens it is typed with", () => {
    for (const query of ["+60 12-345 6789", "+60123456789", "60123456789", "012-345 6789", "0123456789", "12 345", "6789"]) {
      expect(found(query), query).toEqual(["olga"]);
    }
    for (const query of ["(03) 7788 1122", "03-7788 1122", "0377881122", "+603 7788 1122", "7788-1122"]) {
      expect(found(query), query).toEqual(["ivan"]);
    }
    // A phone number and a word: every word must match.
    expect(found("olga 6789")).toEqual(["olga"]);
    expect(found("ivan 6789")).toEqual([]);
    expect(found("012-999 0000")).toEqual([]);
  });

  it("shows everyone without a search, spaces included", () => {
    expect(found("")).toBeNull();
    expect(found("   ")).toBeNull();
    expect(isSearching(" \t")).toBe(false);
    expect(isSearching("a")).toBe(true);
  });

  it("spells a phone number by its digits, a Malaysian one saved without its country code with it too", () => {
    expect(phoneSpellings("+60 12-345 6789")).toEqual(["60123456789"]);
    expect(phoneSpellings("012-345 6789")).toEqual(["0123456789", "60123456789"]);
    expect(phoneSpellings("(03) 7788 1122")).toEqual(["0377881122", "60377881122"]);
    expect(phoneSpellings("+44 20 7946 0958")).toEqual(["442079460958"]);
    expect(phoneSpellings(null)).toEqual([]);
    expect(phoneSpellings("")).toEqual([]);
  });

  it("reads a search as a phone number only when it is digits, spaces, brackets, hyphens and a leading +", () => {
    expect(phoneDigits(" +60 12-345 6789 ")).toBe("60123456789");
    expect(phoneDigits("(03) 7788-1122")).toBe("0377881122");
    expect(phoneDigits("42")).toBe("42");
    for (const query of ["SC-0042", "olga 6789", "6789+", "()", "-", ""]) expect(phoneDigits(query), query).toBeNull();
  });

  it("spells a UID the ways an admin may type it", () => {
    expect(uidSpellings("SC-0042")).toEqual(["SC-0042", "SC0042", "SC-42", "SC42"]);
    expect(uidSpellings("SC-10000")).toEqual(["SC-10000", "SC10000"]);
    expect(uidSpellings("not a uid")).toEqual(["not a uid"]);
  });

  it("reads the first ?q=, as typed, and no more than the box takes", () => {
    expect(readSearch("SC-0042")).toBe("SC-0042");
    expect(readSearch(["olga", "ivan"])).toBe("olga");
    expect(readSearch(undefined)).toBe("");
    expect(readSearch("x".repeat(500))).toHaveLength(MAX_SEARCH_LENGTH);
  });
});

describe("queryAfterViewChange", () => {
  it("keeps the search the Team picker brought along in the address, as typed since", () => {
    expect(queryAfterViewChange("olga", "olga")).toBe("olga");
    // Typed on while the picked team loaded: the box keeps what is in it now.
    expect(queryAfterViewChange("olga ot", "olga")).toBe("olga ot");
    expect(queryAfterViewChange(" SC-0042 ", "SC-0042")).toBe(" SC-0042 ");
  });

  it("drops it for a link to a team (a lead's name, Show Them, Show Their Team), so the team shows whole", () => {
    expect(queryAfterViewChange("olga", "")).toBe("");
    expect(queryAfterViewChange("olga", "   ")).toBe("");
    expect(queryAfterViewChange("", "")).toBe("");
  });
});

describe("listSummary", () => {
  it("says how many people the view shows, as before, without a search or when everyone matches", () => {
    expect(listSummary({ kind: "everyone" }, 12, 12, null)).toBe("12 people.");
    expect(listSummary({ kind: "everyone" }, 1, 1, null)).toBe("1 person.");
    expect(listSummary({ kind: "everyone" }, 12, 12, 12)).toBe("12 people.");
    expect(listSummary(LINA, 3, 12, null)).toBe("Lina Lead's team: 2 inspectors.");
    expect(listSummary({ kind: "no-lead" }, 2, 12, null)).toBe("2 inspectors in no team.");
    expect(listSummary({ kind: "no-lead" }, 0, 12, null)).toBe("Every active inspector has a lead inspector.");
  });

  it("says how many of the view a search leaves", () => {
    expect(listSummary({ kind: "everyone" }, 12, 12, 1)).toBe("1 of 12 people.");
    expect(listSummary({ kind: "everyone" }, 1, 1, 0)).toBe("0 of 1 person.");
    expect(listSummary(LINA, 3, 12, 1)).toBe("Lina Lead's team: 1 of 3 people.");
    expect(listSummary({ kind: "no-lead" }, 2, 12, 0)).toBe("0 of 2 inspectors in no team.");
  });
});

describe("noMatchMessage", () => {
  it("says the search found nobody in the view, quoting it as typed, on one line", () => {
    expect(noMatchMessage({ kind: "everyone" }, "  SC-9999 ")).toBe("Nobody matches “SC-9999”.");
    expect(noMatchMessage(LINA, "olga\n other")).toBe("Nobody in Lina Lead's team matches “olga other”.");
    expect(noMatchMessage({ kind: "no-lead" }, "ivan")).toBe("None of the inspectors in no team match “ivan”.");
  });
});
