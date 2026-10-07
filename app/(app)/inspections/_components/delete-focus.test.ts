import { describe, expect, it } from "vitest";
import { landingAfterCancel, landingAfterDelete } from "./delete-focus";

describe("landingAfterDelete", () => {
  it("waits while the deleted row is still on screen", () => {
    expect(landingAfterDelete(["a", "b", "c"], { id: "b", nextId: "c", index: 1 })).toBe("wait");
  });

  it("lands on the row that came after the deleted one", () => {
    expect(landingAfterDelete(["a", "c"], { id: "b", nextId: "c", index: 1 })).toEqual({ row: "c" });
  });

  it("follows that row even if the list moved meanwhile", () => {
    // Someone else's new inspection arrived at the top.
    expect(landingAfterDelete(["new", "a", "c"], { id: "b", nextId: "c", index: 1 })).toEqual({ row: "c" });
  });

  it("lands on the row now in its place when the next one is gone too, such as one from the next page", () => {
    expect(landingAfterDelete(["a", "z"], { id: "b", nextId: null, index: 1 })).toEqual({ row: "z" });
    expect(landingAfterDelete(["a", "d"], { id: "b", nextId: "c", index: 1 })).toEqual({ row: "d" });
  });

  it("lands on the start of the results when the deleted row was the last one", () => {
    expect(landingAfterDelete(["a", "b"], { id: "c", nextId: null, index: 2 })).toBe("results");
    expect(landingAfterDelete([], { id: "a", nextId: null, index: 0 })).toBe("results");
  });
});

describe("landingAfterCancel", () => {
  it("lands on the row's own main action when it is still listed", () => {
    expect(landingAfterCancel(["a", "b", "c"], { id: "b", nextId: "c", index: 1 })).toEqual({ row: "b" });
  });

  it("lands where the row was when it has gone, else on the start of the results", () => {
    expect(landingAfterCancel(["a", "c"], { id: "b", nextId: "c", index: 1 })).toEqual({ row: "c" });
    expect(landingAfterCancel(["a"], { id: "b", nextId: null, index: 1 })).toBe("results");
  });
});
